import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseVoiceSandboxConfig,runVoiceSandboxEvaluation,VoiceSandboxConfigurationError } from '../release/voice-sandbox.js'

const execute=process.argv.includes('--evaluate')
try{
  const config=parseVoiceSandboxConfig(process.env)
  if(!execute)console.log(JSON.stringify({status:'passed',mode:'preflight',detail:'Voice sandbox configuration is complete, non-production, and explicitly authorized'},null,2))
  else{
    const report=await runVoiceSandboxEvaluation(config);const root=resolve(process.cwd(),'release-evidence');const output=resolve(process.cwd(),config.evidenceOutput);if(!output.startsWith(`${root}/`))throw new Error('VOICE_SANDBOX_EVIDENCE_OUTPUT escaped release-evidence/')
    await mkdir(root,{recursive:true});await writeFile(output,`${JSON.stringify(report,null,2)}\n`,{encoding:'utf8',flag:'wx'});console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1
  }
}catch(error){
  if(error instanceof VoiceSandboxConfigurationError)console.error(JSON.stringify({status:'failed',mode:execute?'evaluate':'preflight',issues:error.issues},null,2))
  else console.error(JSON.stringify({status:'failed',mode:execute?'evaluate':'preflight',issues:['Voice sandbox evaluation failed without exposing provider or client data']},null,2))
  process.exitCode=1
}
