export type RecoveryReviewInput={
  submissionKey:string
  contactName:string
  businessEmail:string
  salonName:string
  locations:'one'|'two_to_five'|'six_plus'
  bookingPlatform:'square'|'fresha'|'phorest'|'other'
  monthlyAppointments:number
  averageTicketMinor:number
  primaryRevenueLoss:'unanswered_enquiries'|'cancellations'|'lapsed_clients'|'rebooking'
  channels:Array<'whatsapp'|'sms'|'email'|'voice'>
  marketingConsent:boolean
  privacyNoticeVersion:'recovery-review-v1'
  calculator:{monthlyEnquiries:number;unansweredPercentage:number;bookingConversionPercentage:number;averageTicketMinor:number;lateCancellationPercentage:number}
  sourcePath:string
  locationSlug?:string
  website:string
  botToken:string
}

export type RecoveryReviewResult={accepted:true;referenceId:string;duplicate:boolean;estimatedRecoveryMinor?:number;currency?:'GBP'}

const baseUrl=String(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'')

export async function submitRecoveryReview(input:RecoveryReviewInput):Promise<RecoveryReviewResult>{
  const response=await fetch(`${baseUrl}/public/recovery-reviews`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(input)})
  const payload=await response.json().catch(()=>({})) as RecoveryReviewResult&{message?:string}
  if(!response.ok)throw new Error(payload.message??'The recovery review request could not be submitted.')
  return payload
}
