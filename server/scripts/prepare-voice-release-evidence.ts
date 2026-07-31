import { readFile } from 'node:fs/promises'
import { prepareVoiceReleaseEvidencePayload } from '../release/voice-sandbox.js'

const path=process.argv[2]
try{
  if(!path)throw new Error('VOICE_SANDBOX_REPORT_PATH_REQUIRED')
  const reportText=await readFile(path,'utf8')
  const payload=prepareVoiceReleaseEvidencePayload(reportText,{aiDisclosureAudible:acknowledged('VOICE_RELEASE_AI_DISCLOSURE_AUDIBLE'),transferCompleted:acknowledged('VOICE_RELEASE_TRANSFER_COMPLETED'),silenceBehaviorAcceptable:acknowledged('VOICE_RELEASE_SILENCE_ACCEPTABLE'),interruptionBehaviorAcceptable:acknowledged('VOICE_RELEASE_INTERRUPTION_ACCEPTABLE')})
  console.log(JSON.stringify(payload,null,2))
}catch{
  console.error(JSON.stringify({status:'failed',issues:['A passed write-once sandbox report and all four explicit human observation acknowledgements are required.']},null,2));process.exitCode=1
}

function acknowledged(name:string):true{if(process.env[name]!=='true')throw new Error(`${name}_REQUIRED`);return true}
