import { SyncStorage } from '../src/index.js';
const assert={
    equal(a:any,b:any){
        if(a!==b){
            throw new Error(`${a}!==${b}`);
        }
    }
};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const storage = await SyncStorage.create();
(globalThis as any).storage = storage;
let theValue;
const reg=/value\d+\.\d+/;
const m=reg.exec(location.href);
if(m){
    theValue=m[0];
    assert.equal(storage.getItem('key'), theValue);
    console.log("theValue",theValue);
    storage.removeItem('key');
}else{
    theValue="value"+Math.random();
    storage.setItem('key', theValue);
    assert.equal(storage.getItem('key'), theValue);
    while(storage.uncommited){
        console.log(storage.uncommited);
        await sleep(1);
    }
    await sleep(1000);
    location.href+="?"+theValue;
}