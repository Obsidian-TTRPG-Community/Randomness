/** @jest-environment node */
/**
 * TF-ShopPick: emits "subtype|name" for the Town Forge naming hook.
 * The name is drawn from the chosen subtype's own pool, so subtype and
 * name are always correlated. The hook splits on "|" and writes both
 * to frontmatter; the body template then rolls TF-ShopByType with the
 * same subtype+name for a fully coherent shop.
 */
import * as fs from "fs"; import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";
const S = path.resolve(__dirname, "../../demo/shops");
function la(){const o:Record<string,string>={};for(const f of fs.readdirSync(S))if(f.endsWith(".ipt"))o[f]=fs.readFileSync(path.join(S,f),"utf8");return o;}
function pick(seed:number){
  const f=la();
  const b=resolveBundle("shop.ipt",f["shop.ipt"],{source:inMemorySource(f),callerDir:""});
  return new Evaluator(b.main,b.extras,{seed,promptValues:{town:"X",shopType:"shop",shopName:""}}).runByName("TF-ShopPick");
}
describe("TF-ShopPick",()=>{
  test("always emits subtype|name in the expected format",()=>{
    for(let s=1;s<=30;s++){
      const out=pick(s);
      expect(out).toMatch(/^(general|weapon|armor|alchemy|magic)\|.+$/);
      expect(out.split("|").length).toBe(2);
      expect(out.split("|")[1].trim().length).toBeGreaterThan(2);
    }
  });
  test("name correlates with the emitted subtype",()=>{
    const frags:Record<string,string>={
      "Smoking Alembic":"alchemy","Hilt & Pommel":"weapon",
      "Dented Pauldron":"armor","Wandering Pack":"general","Arcane Curio":"magic",
    };
    for(let s=1;s<=40;s++){
      const [sub,name]=pick(s).split("|");
      for(const [frag,type] of Object.entries(frags)){
        if(name.includes(frag)) expect(type).toBe(sub);
      }
    }
  });
});
