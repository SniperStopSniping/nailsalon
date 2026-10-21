'use strict';
// Pure contract only: same real pg.Client prototype, fake promise driver, no socket.
const {createRequire}=require('node:module');const path=require('node:path');
const {Client}=createRequire(path.join(process.env.SSI_RUNTIME_COPY,'package.json'))('pg');
globalThis.__SSI_CONTRACT_PG_ORIGINAL__=function(input){
 const text=typeof input==='string'?input:input.text;
 if(text.startsWith('EXPLAIN'))return Promise.resolve({rows:[{'QUERY PLAN':[{Plan:{'Node Type':'Seq Scan','Relation Name':'salon_client','Filter':'FORBIDDEN VALUE','Plan Rows':1,'Total Cost':2}}]}]});
 if(text.startsWith('WITH owned AS'))return Promise.resolve({rows:[{backend:this.processID,total:1,groups:[{relation:'salon_client',locktype:'relation',count:1}],identities:[{relation:'salon_client',locktype:'relation',page:null,tuple:null}]}]});
 if(this.__contractFail&&text.startsWith('insert')){this.__contractFail=false;return Promise.reject(Object.assign(new Error('UNRETAINED'),{code:'40001'}));}
 return Promise.resolve({rows:[]});
};
Client.prototype.query=globalThis.__SSI_CONTRACT_PG_ORIGINAL__;
