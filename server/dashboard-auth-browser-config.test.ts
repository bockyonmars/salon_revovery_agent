import { describe,expect,it } from 'vitest'
import { resolveOperationsAuthConfiguration } from '../src/operations-auth-config.js'

const configured=()=>({
  VITE_OIDC_AUTHORITY:'https://identity.example/',
  VITE_OIDC_CLIENT_ID:'salon-dashboard',
  VITE_OIDC_REDIRECT_URI:'https://salon.example/app/auth/callback',
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI:'https://salon.example/app',
  VITE_OIDC_SCOPE:'openid profile email',
})

describe('browser OIDC configuration',()=>{
  it('keeps an unconfigured development workspace in demo mode',()=>{expect(resolveOperationsAuthConfiguration({}, {origin:'http://127.0.0.1:5173',production:false})).toEqual({mode:'disabled'})})

  it('accepts exact same-origin callbacks and normalizes the authority',()=>{expect(resolveOperationsAuthConfiguration(configured(),{origin:'https://salon.example',production:true})).toEqual({mode:'oidc',settings:{authority:'https://identity.example',clientId:'salon-dashboard',redirectUri:'https://salon.example/app/auth/callback',postLogoutRedirectUri:'https://salon.example/app',scope:'openid profile email'}})})

  it('fails closed on partial, cross-origin, insecure, or non-OIDC settings',()=>{
    expect(resolveOperationsAuthConfiguration({VITE_OIDC_CLIENT_ID:'partial'},{origin:'https://salon.example',production:true})).toMatchObject({mode:'invalid'})
    expect(resolveOperationsAuthConfiguration({...configured(),VITE_OIDC_REDIRECT_URI:'https://other.example/app/auth/callback'},{origin:'https://salon.example',production:true})).toEqual({mode:'invalid',message:'Dashboard redirect URLs must use the dashboard origin'})
    expect(resolveOperationsAuthConfiguration({...configured(),VITE_OIDC_AUTHORITY:'http://identity.example'},{origin:'https://salon.example',production:true})).toEqual({mode:'invalid',message:'VITE_OIDC_AUTHORITY must use HTTPS in production'})
    expect(resolveOperationsAuthConfiguration({...configured(),VITE_OIDC_SCOPE:'profile email'},{origin:'https://salon.example',production:true})).toEqual({mode:'invalid',message:'VITE_OIDC_SCOPE must include openid'})
  })
})
