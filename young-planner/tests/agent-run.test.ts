import {it,expect,vi} from "vitest";
import OpenAI from "openai";
import {runAgent} from "../src/lib/agent/run";
import {defaults} from "../src/lib/finance";
const tool=(name:string,args:unknown)=>({choices:[{message:{role:"assistant",content:null,tool_calls:[{id:"call1",type:"function",function:{name,arguments:JSON.stringify(args)}}]}}]});
it("iterates across analysis tools without changing configuration",async()=>{
 const create=vi.fn().mockResolvedValueOnce(tool("search_scenarios",{})).mockResolvedValueOnce(tool("stress_test",{})).mockResolvedValueOnce({choices:[{message:{role:"assistant",content:"분석 결과"}}]});
 const client={chat:{completions:{create}}} as unknown as OpenAI;
 const r=await runAgent(client,"test","최대 자산 찾아줘",defaults,[],new AbortController().signal);
 expect(r.analyses).toHaveLength(2);expect(r.config).toEqual(defaults);expect(create).toHaveBeenCalledTimes(3);
});
it("applies only an explicit change request",async()=>{
 const create=vi.fn().mockResolvedValueOnce(tool("apply_scenario_changes",{changes:{benefits:false, living:280}})).mockResolvedValueOnce({choices:[{message:{role:"assistant",content:"변경했습니다"}}]});
 const r=await runAgent({chat:{completions:{create}}} as unknown as OpenAI,"test","구직급여 없이 생활비 280으로 바꿔줘",defaults,[],new AbortController().signal);
 expect(r.config.benefits).toBe(false);expect(r.config.living).toBe(280);
});
it("keeps completed calculations when follow-up model call fails",async()=>{
 const create=vi.fn().mockResolvedValueOnce(tool("search_scenarios",{})).mockRejectedValueOnce(new Error("timeout"));
 const r=await runAgent({chat:{completions:{create}}} as unknown as OpenAI,"test","최대",defaults,[],new AbortController().signal);
 expect(r.incomplete).toBe(true);expect(r.analyses).toHaveLength(1);expect(r.config).toEqual(defaults);
});
