export type OpenAIRuntimePolicy={timeout:number;maxRetries:0}

export function openAIRuntimePolicy(environment:Record<string,string|undefined>=process.env):OpenAIRuntimePolicy{
  const raw=environment.OPENAI_TIMEOUT_MS?.trim();const timeout=raw===undefined||raw===''?20_000:Number(raw)
  if(!Number.isInteger(timeout)||timeout<1_000||timeout>60_000)throw new Error('OPENAI_TIMEOUT_MS must be an integer from 1000 to 60000')
  return{timeout,maxRetries:0}
}
