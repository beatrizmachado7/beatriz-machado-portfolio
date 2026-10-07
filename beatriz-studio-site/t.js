const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const html=require('fs').readFileSync('beatriz-machado-portfolio/index.html','utf8');
await p.route('http://site.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
await p.goto('http://site.test/');await p.waitForTimeout(300);
const r={title:await p.title(),edit:await p.$('#edtoggle')!==null,forms:await p.$$eval('form[data-netlify]',f=>f.map(x=>x.name)),hero:await p.$eval('.hero-meta',e=>e.innerText.replace(/\s+/g,' '))};
await p.goto('http://site.test/#servicos');await p.waitForTimeout(200);r.cards=await p.$$eval('.card .ctotal',e=>e.length);r.btn=await p.$eval('.card .tlink',e=>e.innerText);
console.log(r,errs);await b.close();})();
