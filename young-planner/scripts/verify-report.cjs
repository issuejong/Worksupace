// Executes the same TypeScript engine against untouched cached Excel fixtures.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
Module._extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,p);
const {engine}=require('../src/lib/finance.ts');
const refs=require('../tests/report-v11.json');
const lines=['시나리오,월,항목,엑셀값(만원),앱값(만원),차이(원),판정'];let max=0,failed=0;
for(const ref of refs){const r=engine(ref.params);r.rows.forEach((row,i)=>{const delta=(row.assets-ref.assets[i])*10000;max=Math.max(max,Math.abs(delta));if(Math.abs(delta)>=1)failed++;lines.push([ref.name,row.date,'월말 금융자산',ref.assets[i],row.assets,delta,Math.abs(delta)<1?'일치':'차이'].join(','));});}
const out=path.resolve(process.argv[2]||'docs/report-verification.csv');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,'\ufeff'+lines.join('\n'));console.log(`${refs.length}개 시나리오 / ${lines.length-1}개월 대조 / 최대오차 ${max.toFixed(6)}원 / 실패 ${failed}\n${out}`);if(failed)process.exitCode=1;
