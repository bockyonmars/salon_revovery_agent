import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'

const sourceUrl=process.env.DATABASE_URL?.trim()
const adminUrl=process.env.BACKUP_DRILL_ADMIN_URL?.trim()
if(!sourceUrl||!adminUrl){
  console.error(JSON.stringify({status:'failed',issues:['DATABASE_URL and BACKUP_DRILL_ADMIN_URL are required']},null,2))
  process.exit(1)
}

const sourceDatabase=databaseName(sourceUrl)
const adminDatabase=databaseName(adminUrl)
if(['postgres','template0','template1'].includes(sourceDatabase))fail('DATABASE_URL must identify the application database, not an administrative database')
if(sourceDatabase===adminDatabase)fail('BACKUP_DRILL_ADMIN_URL must connect to a separate administrative database on the same PostgreSQL server')
const targetDatabase=`salon_restore_drill_${randomBytes(6).toString('hex')}`
const targetUrl=withDatabase(sourceUrl,targetDatabase)
const directory=await mkdtemp(join(tmpdir(),'salon-restore-drill-'))
const dumpPath=join(directory,'backup.dump')
const admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:8_000})
let targetCreated=false

try{
  requireBinary('pg_dump')
  requireBinary('pg_restore')
  await assertSameServer(sourceUrl,adminUrl)
  await admin.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`)
  targetCreated=true
  runDatabaseCommand('pg_dump',['--format=custom','--no-owner','--no-acl','--file',dumpPath],sourceUrl)
  runDatabaseCommand('pg_restore',['--no-owner','--no-acl','--exit-on-error'],targetUrl,dumpPath)
  const [sourceCounts,restoredCounts]=await Promise.all([criticalCounts(sourceUrl),criticalCounts(targetUrl)])
  const mismatches=Object.keys(sourceCounts).filter(table=>sourceCounts[table]!==restoredCounts[table])
  if(mismatches.length)throw new Error(`RESTORE_COUNT_MISMATCH_${mismatches.join('_')}`)
  console.log(JSON.stringify({status:'passed',targetDatabase,criticalTableCounts:restoredCounts,detail:'Encrypted-storage policy is infrastructure-owned; this drill verified a fresh logical restore and critical table counts'},null,2))
}catch(error){
  console.error(JSON.stringify({status:'failed',code:safeCode(error),detail:'PostgreSQL backup restoration was not demonstrated'},null,2))
  process.exitCode=1
}finally{
  if(targetCreated){
    try{await admin.query(`DROP DATABASE ${quoteIdentifier(targetDatabase)} WITH (FORCE)`)}catch(error){console.error(JSON.stringify({status:'cleanup_failed',targetDatabase,code:safeCode(error)},null,2));process.exitCode=1}
  }
  await admin.end()
  await rm(directory,{recursive:true,force:true})
}

async function criticalCounts(connectionString:string){
  const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:8_000,statement_timeout:15_000})
  const tables=['tenants','locations','bookings','domain_events','workflow_jobs','audit_log','square_booking_webhook_state']
  try{
    const result:Record<string,number>={}
    for(const table of tables){const count=await pool.query<{count:string}>(`SELECT count(*)::text AS count FROM ${quoteIdentifier(table)}`);result[table]=Number(count.rows[0]?.count??0)}
    return result
  }finally{await pool.end()}
}

async function assertSameServer(source:string,adminConnection:string){
  const sourcePool=new Pool({connectionString:source,max:1,connectionTimeoutMillis:8_000})
  try{
    const [sourceIdentity,adminIdentity]=await Promise.all([
      sourcePool.query<{address:string;port:number}>("SELECT COALESCE(inet_server_addr()::text,'local') AS address, inet_server_port() AS port"),
      admin.query<{address:string;port:number}>("SELECT COALESCE(inet_server_addr()::text,'local') AS address, inet_server_port() AS port"),
    ])
    const left=sourceIdentity.rows[0];const right=adminIdentity.rows[0]
    if(!left||!right||left.address!==right.address||left.port!==right.port)throw new Error('BACKUP_DRILL_SERVER_MISMATCH')
  }finally{await sourcePool.end()}
}

function requireBinary(name:string){const result=spawnSync(name,['--version'],{encoding:'utf8'});if(result.error||result.status!==0)throw new Error(`${name.toUpperCase()}_UNAVAILABLE`)}
function runDatabaseCommand(command:string,args:string[],connectionString:string,trailingArg?:string){const connection=processSafeConnection(connectionString);const commandArgs=[...args,command==='pg_dump'?connection.url:`--dbname=${connection.url}`,...(trailingArg?[trailingArg]:[])];const result=spawnSync(command,commandArgs,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,...(connection.password?{PGPASSWORD:connection.password}:{})}});if(result.error||result.status!==0)throw new Error(`${command.toUpperCase()}_FAILED`)}
function processSafeConnection(connectionString:string){const value=new URL(connectionString);const password=decodeURIComponent(value.password);value.password='';return{url:value.toString(),password}}
function databaseName(connectionString:string){try{const value=decodeURIComponent(new URL(connectionString).pathname.replace(/^\//,''));if(!value)throw new Error();return value}catch{fail('Database URLs must be valid PostgreSQL URLs')}}
function withDatabase(connectionString:string,database:string){const value=new URL(connectionString);value.pathname=`/${database}`;return value.toString()}
function quoteIdentifier(value:string){if(!/^[a-z][a-z0-9_]{1,62}$/.test(value))throw new Error('UNSAFE_DATABASE_IDENTIFIER');return`"${value}"`}
function safeCode(error:unknown){const message=error instanceof Error?error.message:'RESTORE_DRILL_FAILED';return/^[A-Z0-9_]{1,120}$/.test(message)?message:'RESTORE_DRILL_FAILED'}
function fail(message:string):never{console.error(JSON.stringify({status:'failed',issues:[message]},null,2));process.exit(1)}
