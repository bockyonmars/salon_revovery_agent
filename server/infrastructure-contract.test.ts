import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const terraform=(file:string)=>readFile(new URL(`../infra/terraform/${file}`,import.meta.url),'utf8')
const terraformFiles=['versions.tf','variables.tf','network.tf','data.tf','edge.tf','iam.tf','ecs.tf','observability.tf','outputs.tf']

describe('production infrastructure contract',()=>{
  it('keeps configuration structurally balanced and free of non-HCL statement separators',async()=>{
    const files=await Promise.all(terraformFiles.map(terraform));for(const source of files){expect(outsideQuoted(source)).not.toContain(';');expect(balance(source,'{','}')).toBe(0);expect(balance(source,'[',']')).toBe(0);expect(source.split('"').length%2).toBe(1)}
  })
  it('pins immutable artifacts and deploys three independently scalable private services',async()=>{
    const[variables,ecs,network]=await Promise.all([terraform('variables.tf'),terraform('ecs.tf'),terraform('network.tf')])
    expect(variables).toContain('@sha256:[0-9a-f]{64}$')
    expect(variables).toContain('services_enabled')
    expect(variables).toContain('default = false')
    expect(ecs).toContain('api = { port = 4100')
    expect(ecs).toContain('webhook = { port = 4200')
    expect(ecs).toContain('worker = { port = 4300')
    expect(ecs).toContain('assign_public_ip = false')
    expect(ecs).toContain('deployment_circuit_breaker')
    expect(ecs).toContain('aws_appautoscaling_target')
    expect(ecs).toContain('desired_count = var.services_enabled ? var.service_desired_count : 0')
    expect(network.match(/resource "aws_subnet" "(?:public|application|data)"/g)).toHaveLength(3)
    expect(network).toContain('aws_nat_gateway.main[each.value].id')
  })

  it('keeps credentials out of Terraform values and protects durable data',async()=>{
    const[data,ecs,iam,example]=await Promise.all([terraform('data.tf'),terraform('ecs.tf'),terraform('iam.tf'),terraform('terraform.tfvars.example')])
    expect(data).toContain('manage_master_user_password    = true')
    expect(data).toContain('multi_az                       = true')
    expect(data).toContain('deletion_protection            = var.db_deletion_protection')
    expect(data).toContain('multi_az_enabled           = true')
    expect(data).toContain('at_rest_encryption_enabled = true')
    expect(data).toContain('transit_encryption_enabled = true')
    expect(data).toContain('block_public_acls = true')
    expect(data).toContain('sse_algorithm = "aws:kms"')
    expect(data).toContain('CloudWatchLogsEncryption')
    expect(data).toContain('DenyInsecureTransport')
    expect(ecs).toContain(':username::')
    expect(ecs).toContain(':password::')
    expect(ecs).not.toContain('DATABASE_URL')
    expect(iam).toContain('secretsmanager:GetSecretValue')
    expect(example).toContain('provide ARNs only')
    expect(example).not.toMatch(/(?:sk-live|whsec_|AC[a-f0-9]{32})/i)
  })

  it('terminates modern TLS, separates webhook traffic, and enables WAF and operational telemetry',async()=>{
    const[edge,observability,readme]=await Promise.all([terraform('edge.tf'),terraform('observability.tf'),terraform('README.md')])
    expect(edge).toContain('ELBSecurityPolicy-TLS13-1-2-2021-06')
    expect(edge).toContain('values = ["/webhooks", "/webhooks/*"]')
    expect(edge).toContain('AWSManagedRulesCommonRuleSet')
    expect(edge).toContain('AWSManagedRulesKnownBadInputsRuleSet')
    expect(edge).toContain('rate_based_statement')
    expect(edge.match(/path = "\/readyz"/g)).toHaveLength(1)
    expect(observability).toContain('aws_cloudwatch_dashboard')
    expect(observability).toContain('HTTPCode_ELB_5XX_Count')
    expect(observability).toContain('FreeStorageSpace')
    expect(readme).toContain('one-off database migration')
    expect(readme).toContain('exit code `0`')
  })
})

function balance(source:string,open:string,close:string){let depth=0;let quoted=false;let escaped=false;for(const character of source){if(escaped){escaped=false;continue}if(character==='\\'&&quoted){escaped=true;continue}if(character==='"'){quoted=!quoted;continue}if(quoted)continue;if(character===open)depth+=1;if(character===close)depth-=1;if(depth<0)return depth}return depth}
function outsideQuoted(source:string){let result='';let quoted=false;let escaped=false;for(const character of source){if(escaped){escaped=false;continue}if(character==='\\'&&quoted){escaped=true;continue}if(character==='"'){quoted=!quoted;continue}if(!quoted)result+=character}return result}
