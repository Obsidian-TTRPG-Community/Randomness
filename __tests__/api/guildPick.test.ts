/** @jest-environment node */
/**
 * TF-GuildPick + TF-GuildByType: the guild equivalents of TF-ShopPick
 * and TF-ShopByType, for the Town Forge naming hook.
 *
 * TF-GuildPick emits "category|name" (correlated; criminal gets a
 * cant/street-name). The hook splits on "|" and writes category as the
 * note's subtype. TF-GuildByType then rolls a guild of that category
 * (honouring slant), falling back to a random guild for unknown
 * categories so the note is never empty.
 */
import * as fs from "fs"; import * as path from "path";
import { Evaluator } from "../../src/engine/evaluator";
import { inMemorySource, resolveBundle } from "../../src/resolver/fileResolver";
const S = path.resolve(__dirname, "../../community-generators/fantasy-hub/generators");
function la(){const o:Record<string,string>={};for(const f of fs.readdirSync(S))if(f.endsWith(".rdm"))o[f]=fs.readFileSync(path.join(S,f),"utf8");return o;}
function run(table:string,seed:number,type="",slant="any"){
  const f=la();
  const b=resolveBundle("place-guild.rdm",f["place-guild.rdm"],{source:inMemorySource(f),callerDir:""});
  return new Evaluator(b.main,b.extras,{seed,promptValues:{town:"Frostkey",shopType:type,shopName:"",slant}}).runByName(table);
}
const cats=["craft","religious","military","criminal","arcane","civic"];
describe("TF-GuildPick",()=>{
  test("emits category|name in the expected format",()=>{
    for(let s=1;s<=30;s++){
      const out=run("TF-GuildPick",s);
      expect(out).toMatch(/^(craft|religious|military|criminal|arcane|civic)\|.+$/);
      expect(out.split("|")[1].trim().length).toBeGreaterThan(2);
    }
  });
  test("criminal picks use cant names, not formal 'Guild of'",()=>{
    for(let s=1;s<=60;s++){
      const [cat,name]=run("TF-GuildPick",s).split("|");
      if(cat==="criminal") expect(name).not.toMatch(/^The (Guild|Order|Company) of/);
    }
  });
});
describe("TF-GuildByType",()=>{
  for(const c of cats){
    test(`category '${c}' locks to a ${c} guild`,()=>{
      for(let s=1;s<=4;s++){
        const out=run("TF-GuildByType",s,c);
        expect(out).toContain(`${c} guild`);
        expect(out).toContain("Frostkey");
      }
    });
  }
  for(const c of ["","guild","thieves","CRAFT"]){
    test(`unknown category '${c}' falls back (never empty)`,()=>{
      for(let s=1;s<=4;s++){
        const out=run("TF-GuildByType",s,c);
        expect(out.startsWith("**")).toBe(true);
        expect(out.length).toBeGreaterThan(100);
      }
    });
  }
  test("slant is honoured under a locked category",()=>{
    for(let s=1;s<=10;s++){
      const out=run("TF-GuildByType",s,"craft","good");
      expect(out).not.toContain("rotten at the top");
    }
  });
});
