/** @jest-environment node */
/**
 * TF-ShopByType: dispatches on the shopType prompt so a note that
 * already knows its subtype (e.g. Town Forge writes subtype: alchemy)
 * gets a coherent body of that exact type. Unknown/blank subtypes fall
 * back to a random shop so the note is never empty.
 */
import * as fs from "fs"; import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";
const S = path.resolve(__dirname, "../../demo/shops");
function la(){const o:Record<string,string>={};for(const f of fs.readdirSync(S))if(f.endsWith(".ipt"))o[f]=fs.readFileSync(path.join(S,f),"utf8");return o;}
function roll(seed:number,type:string,name=""){
  const f=la();
  const b=resolveBundle("shop.ipt",f["shop.ipt"],{source:inMemorySource(f),callerDir:""});
  return new Evaluator(b.main,b.extras,{seed,promptValues:{town:"Frostkey",shopType:type,shopName:name}}).runByName("TF-ShopByType");
}
const labels:Record<string,string>={general:"general goods",weapon:"weapons",armor:"armor",alchemy:"alchemy",magic:"magic"};
describe("TF-ShopByType",()=>{
  for(const [t,label] of Object.entries(labels)){
    test(`subtype '${t}' locks to a ${label} shop`,()=>{
      for(let s=1;s<=6;s++){
        const out=roll(s,t);
        expect(out).toContain("("+label);
        expect(out).toContain("Frostkey");
        expect(out).toMatch(/\d+ (gp|sp|cp)/);
      }
    });
  }
  for(const t of ["shop","","alchemist","WEAPON"]){
    test(`unknown subtype '${t}' falls back to a real shop (never empty)`,()=>{
      for(let s=1;s<=6;s++){
        const out=roll(s,t);
        expect(out.startsWith("**")).toBe(true);
        expect(out.length).toBeGreaterThan(50);
      }
    });
  }
  test("passed shopName is used with the locked type",()=>{
    const out=roll(1,"alchemy","The Smoking Alembic");
    expect(out).toContain("The Smoking Alembic");
    expect(out).toContain("(alchemy");
  });
});
