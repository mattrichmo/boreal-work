#!/usr/bin/env node
import { GlobalServiceClient } from "./client.js";
import { spawn } from "node:child_process";
import { GlobalController, render, runInteractive, runLineInterface, type KeyTerminal } from "./interface.js";

export interface LaunchOptions { socket: string; interactive: boolean; timeoutMs: number }
export function parseArgs(argv: readonly string[]): LaunchOptions {
  const at = argv.indexOf("--socket"); const socket = at < 0 ? undefined : argv[at + 1];
  if (!socket || socket.startsWith("--")) throw new Error("usage: bwrk-global-tui --socket PATH [--interactive] [--timeout-ms N]");
  const timeoutAt=argv.indexOf("--timeout-ms"); const timeoutMs=timeoutAt<0?10_000:Number(argv[timeoutAt+1]);
  if(!Number.isInteger(timeoutMs)||timeoutMs<=0) throw new Error("--timeout-ms must be a positive integer");
  for(let i=0;i<argv.length;i++) if(argv[i].startsWith("--")&&!(["--socket","--interactive","--timeout-ms","--help","-h"].includes(argv[i]))) throw new Error(`unknown option ${argv[i]}`);
  return {socket,interactive:argv.includes("--interactive"),timeoutMs};
}
async function* inputLines(): AsyncIterable<string> {
  let rest="";
  const decoder = new TextDecoder();
  for await (const chunk of process.stdin) {
    rest+=typeof chunk==="string"?chunk:decoder.decode(chunk,{stream:true});
    const parts=rest.split(/\r?\n/); rest=parts.pop()??"";
    for(const line of parts) yield line;
  }
  rest+=decoder.decode();
  if(rest) yield rest;
}
function terminal(): KeyTerminal {
  return {
    isTty:process.stdin.isTTY===true&&process.stdout.isTTY===true,
    theme:process.env.NO_COLOR ? "mono" : "dark",
    dimensions:()=>({width:process.stdout.columns??100,height:process.stdout.rows??40}),
    write:value=>{process.stdout.write(value);},
    setRawMode:enabled=>{process.stdin.setRawMode?.(enabled); if(enabled)process.stdin.resume?.(); else process.stdin.pause?.();},
    onData(listener) { const cb=(data:string|Uint8Array)=>listener(data); process.stdin.on("data",cb); return ()=>process.stdin.off("data",cb); },
    onSignal(signal,listener) { process.on(signal,listener); return ()=>process.off(signal,listener); },
    onResize(listener) { process.stdout.on("resize",listener); return ()=>process.stdout.off("resize",listener); },
    async openLinkedWorkspace(path: string) {
      const executable = process.env.BOREAL_DASHBOARD_BINARY;
      if (!executable || !executable.startsWith("/")) throw new Error("Project dashboard handoff is unavailable for this launch.");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, ["dashboard"], { cwd: path, stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Project dashboard exited ${signal ?? code ?? "without a result"}.`)));
      });
    },
  };
}
export async function main(argv: readonly string[]=process.argv.slice(2)): Promise<void> {
  if(argv.includes("--help")||argv.includes("-h")){process.stdout.write("Usage: bwrk-global-tui --socket PATH [--interactive] [--timeout-ms N]\n");return;}
  let client:GlobalServiceClient|undefined;
  try {
    const options=parseArgs(argv); client=new GlobalServiceClient(options.socket,options.timeoutMs);
    const controller=new GlobalController(client);
    if(options.interactive&&process.stdin.isTTY===true&&process.stdout.isTTY===true) await runInteractive(controller,terminal());
    else if(options.interactive) await runLineInterface(controller,inputLines(),value=>process.stdout.write(value));
    else {await controller.refresh();process.stdout.write(render(controller));}
  } catch(error) { process.stderr.write(`bwrk-global-tui: ${error instanceof Error?error.message:String(error)}\n`); process.exitCode=1; }
  void client;
}
if(process.argv[1]?.endsWith("/entrypoint.js")) void main();
