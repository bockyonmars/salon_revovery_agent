import { publicBotProtectionReleaseConfig } from '../services/public-bot-protection-service.js'

try{
  const result=publicBotProtectionReleaseConfig(process.env)
  console.log(JSON.stringify({status:'passed',control:'public_turnstile_siteverify',...result}))
}catch(error){
  console.error(error instanceof Error?error.message:'Public bot protection configuration is invalid')
  process.exitCode=1
}
