const {app,BrowserWindow,shell} = require('electron');
const path=require('path');
const WEB_URL=process.env.KREASIAI_WEB_URL||'http://localhost:3000';
function createWindow(){const win=new BrowserWindow({width:1440,height:900,minWidth:1100,minHeight:700,backgroundColor:'#07110d',webPreferences:{contextIsolation:true,nodeIntegration:false}});win.loadURL(WEB_URL);win.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return {action:'deny'}})}
app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
