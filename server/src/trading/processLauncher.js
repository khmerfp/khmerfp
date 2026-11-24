import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tradingProcessEnvironment} from './processEnvironment.js';
export function startTradingProcess(mode,environment) {
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./localProcess.js',import.meta.url)),mode],{env:tradingProcessEnvironment(mode,environment),stdio:['ignore','inherit','inherit','ipc']});
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Trading process startup timeout.'))},15000);
  child.once('error',error=>{clearTimeout(timeout);reject(error)});
  child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Trading process exited before readiness.'))});
  child.on('message',message=>{if(message?.type==='ready'&&message.mode===mode){clearTimeout(timeout);child.ready=message;resolve(child)}});
 });
}
export async function stopTradingProcess(child) {
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(new Error('Trading process shutdown timeout.'))},15000);child.once('exit',(code)=>{clearTimeout(timeout);if(code===0)resolve();else reject(new Error('Trading process did not shut down cleanly.'))});if(child.connected)child.send({type:'stop'});else child.kill()});
}
