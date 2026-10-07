-- KreasiAI Phase 11: Midtrans payment processing + atomic subscription/credit activation.
-- Additive migration. Does not remove existing kai_* data.

create unique index if not exists kai_billing_orders_midtrans_reference_uidx
  on public.kai_billing_orders(provider, provider_reference)
  where provider_reference is not null;

create index if not exists kai_subscriptions_user_updated_idx
  on public.kai_subscriptions(user_id, updated_at desc);

create or replace function public.kai_process_midtrans_event(
  p_provider_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_provider_reference text,
  p_payload jsonb,
  p_final_status text,
  p_success boolean,
  p_transaction_id text default null,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_event_inserted boolean := false;
  v_order public.kai_billing_orders%rowtype;
  v_profile public.kai_profiles%rowtype;
  v_subscription public.kai_subscriptions%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_status text := lower(coalesce(p_final_status, 'pending'));
  v_was_paid boolean := false;
begin
  if coalesce(trim(p_provider_event_id), '') = '' then
    raise exception 'MIDTRANS_EVENT_ID_REQUIRED';
  end if;

  insert into public.kai_billing_events(
    provider, provider_event_id, event_type, order_id, payload
  ) values (
    'midtrans', p_provider_event_id, coalesce(p_event_type,'unknown'), p_order_id, coalesce(p_payload,'{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  v_event_inserted := true;

  select * into v_order
  from public.kai_billing_orders
  where id = p_order_id
  for update;

  if not found then
    update public.kai_billing_events
    set processed_at = now()
    where id = v_event_id;
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'ORDER_NOT_FOUND');
  end if;

  if v_order.provider <> 'midtrans' then
    raise exception 'PROVIDER_MISMATCH';
  end if;

  if coalesce(p_provider_reference,'') <> coalesce(v_order.provider_reference,'') then
    raise exception 'REFERENCE_MISMATCH';
  end if;

  if p_success then
    v_was_paid := (v_order.status = 'paid');
    if not v_was_paid then
      update public.kai_billing_orders
      set status = 'paid',
          provider_reference = coalesce(p_provider_reference, provider_reference),
          paid_at = coalesce(p_paid_at, now()),
          metadata = jsonb_set(
            coalesce(metadata,'{}'::jsonb),
            '{midtrans,last_success_event}',
            jsonb_build_object(
              'event_id', p_provider_event_id,
              'transaction_id', p_transaction_id,
              'event_type', p_event_type,
              'processed_at', now()
            ),
            true
          ),
          updated_at = now()
      where id = v_order.id;

      select * into v_profile from public.kai_profiles where id = v_order.user_id for update;
      if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

      update public.kai_profiles
      set plan = v_order.plan_id,
          credits = credits + greatest(v_order.credits, 0),
          updated_at = now()
      where id = v_order.user_id;

      insert into public.kai_credit_ledger(user_id, amount, reason, metadata)
      values (
        v_order.user_id,
        greatest(v_order.credits, 0),
        'subscription_purchase',
        jsonb_build_object(
          'order_id', v_order.id,
          'provider', 'midtrans',
          'provider_reference', p_provider_reference,
          'transaction_id', p_transaction_id,
          'plan_id', v_order.plan_id
        )
      );

      select * into v_subscription
      from public.kai_subscriptions
      where user_id = v_order.user_id
      order by updated_at desc
      limit 1
      for update;

      v_period_start := coalesce(v_subscription.current_period_end, now());
      if v_subscription.id is not null and v_subscription.status = 'active' and v_subscription.current_period_end > now() then
        v_period_end := v_subscription.current_period_end + interval '1 month';
      else
        v_period_start := now();
        v_period_end := now() + interval '1 month';
      end if;

      if v_subscription.id is null then
        insert into public.kai_subscriptions(
          user_id, plan_id, provider, provider_customer_id, provider_subscription_id,
          status, current_period_end
        ) values (
          v_order.user_id,
          v_order.plan_id,
          'midtrans',
          null,
          null,
          'active',
          v_period_end
        );
      else
        update public.kai_subscriptions
        set plan_id = v_order.plan_id,
            provider = 'midtrans',
            status = 'active',
            current_period_end = v_period_end,
            updated_at = now()
        where id = v_subscription.id;
      end if;
    end if;
  else
    -- Do not downgrade an order that was already confirmed paid by an earlier notification.
    if v_order.status <> 'paid' then
      update public.kai_billing_orders
      set status = case
        when v_status in ('pending','failed','cancelled','expired','refunded') then v_status
        else 'pending'
      end,
      metadata = jsonb_set(
        coalesce(metadata,'{}'::jsonb),
        '{midtrans,last_event}',
        jsonb_build_object(
          'event_id', p_provider_event_id,
          'transaction_id', p_transaction_id,
          'event_type', p_event_type,
          'status', v_status,
          'processed_at', now()
        ),
        true
      ),
      updated_at = now()
      where id = v_order.id;
    end if;
  end if;

  update public.kai_billing_events
  set processed_at = now()
  where id = v_event_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order_id', v_order.id,
    'status', case when p_success then 'paid' else v_status end,
    'credits_applied', case when p_success and not v_was_paid then greatest(v_order.credits,0) else 0 end
  );
exception
  when others then
    if v_event_inserted and v_event_id is not null then
      update public.kai_billing_events set processed_at = null where id = v_event_id;
    end if;
    raise;
end;
$$;

revoke all on function public.kai_process_midtrans_event(text,text,uuid,text,jsonb,text,boolean,text,timestamptz) from public;
revoke all on function public.kai_process_midtrans_event(text,text,uuid,text,jsonb,text,boolean,text,timestamptz) from anon;
revoke all on function public.kai_process_midtrans_event(text,text,uuid,text,jsonb,text,boolean,text,timestamptz) from authenticated;
grant execute on function public.kai_process_midtrans_event(text,text,uuid,text,jsonb,text,boolean,text,timestamptz) to service_role;
