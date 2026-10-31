import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
const map=readFileSync('worker/map.html','utf8'),login=readFileSync('worker/login.html','utf8');
const server=readFileSync('worker/server.mjs','utf8');
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js','const MAP_HTML='+JSON.stringify(map)+';\nconst LOGIN_HTML='+JSON.stringify(login)+';\n'+server);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built password-protected live map');
