import { createHash, randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import { SupportKnowledgeArticleInputSchema, SupportKnowledgeSearchSchema, type SupportKnowledgeArticle, type SupportKnowledgeArticleInput, type SupportKnowledgeMatch, type TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'

const STOP_WORDS=new Set(['a','an','and','are','at','be','can','do','for','from','how','i','in','is','it','me','my','of','on','or','the','to','what','when','with','you','your'])

export class SupportKnowledgeService{
  constructor(private readonly store:Store,audit:AuditService){void audit}

  async list(context:TenantContext,includeUnpublished=false){return this.store.listSupportKnowledgeArticles(context,includeUnpublished)}

  async publish(context:TenantContext,slug:string,raw:SupportKnowledgeArticleInput){
    const value=SupportKnowledgeArticleInputSchema.parse(raw)
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>100)throw new DomainError('Knowledge article slug is invalid','KNOWLEDGE_SLUG_INVALID',400)
    if(restrictedContent(`${value.title}\n${value.summary}\n${value.content}`))throw new DomainError('Knowledge content appears to contain credentials or restricted internal instructions','KNOWLEDGE_CONTENT_RESTRICTED',400)
    const existing=await this.store.getSupportKnowledgeArticle(context,slug)
    const now=new Date().toISOString();const contentHash=hash(value)
    const article:SupportKnowledgeArticle={...value,id:existing?.id??randomUUID(),tenantId:context.tenantId,locationId:context.locationId,slug,version:(existing?.version??0)+1,contentHash,updatedBy:context.userId,createdAt:existing?.createdAt??now,updatedAt:now,...(value.status==='published'?{publishedAt:now}:existing?.publishedAt?{publishedAt:existing.publishedAt}:{})}
    return this.store.saveSupportKnowledgeArticleWithAudit(context,article,{auditId:randomUUID(),userId:context.userId,occurredAt:now})
  }

  async search(context:TenantContext,raw:{query:string;limit?:number}):Promise<{matches:SupportKnowledgeMatch[];grounded:boolean}>{
    const input=SupportKnowledgeSearchSchema.parse(raw);const queryTokens=tokens(input.query)
    if(!queryTokens.length)return{matches:[],grounded:false}
    const queryPhrase=normalize(input.query)
    const scored=(await this.store.listSupportKnowledgeArticles(context,false)).flatMap(article=>{
      const score=articleScore(article,queryTokens,queryPhrase)
      return score>=4?[{articleId:article.id,slug:article.slug,version:article.version,title:article.title,summary:article.summary,content:article.content,topics:article.topics,score,contentHash:article.contentHash}]:[]
    }).sort((left,right)=>right.score-left.score||left.slug.localeCompare(right.slug)).slice(0,input.limit)
    return{matches:scored,grounded:scored.length>0}
  }
}

function articleScore(article:SupportKnowledgeArticle,queryTokens:string[],queryPhrase:string){
  const title=tokens(article.title);const summary=tokens(article.summary);const content=tokens(article.content);const topics=new Set(article.topics.flatMap(tokens));let score=0
  for(const token of queryTokens){if(topics.has(token))score+=4;if(title.includes(token))score+=3;if(summary.includes(token))score+=2;if(content.includes(token))score+=1}
  const searchable=normalize(`${article.title} ${article.summary} ${article.content}`);if(queryPhrase.length>=5&&searchable.includes(queryPhrase))score+=5
  return score
}
function tokens(value:string){return[...new Set(normalize(value).split(' ').filter(token=>token.length>=2&&!STOP_WORDS.has(token)))]}
function normalize(value:string){return value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')}
function hash(value:SupportKnowledgeArticleInput){return createHash('sha256').update(JSON.stringify({title:value.title,summary:value.summary,content:value.content,topics:value.topics,status:value.status})).digest('hex')}
function restrictedContent(value:string){return/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|system prompt|developer message|admin credentials?)\b|sk_(?:live|test)_[a-z0-9]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)}
