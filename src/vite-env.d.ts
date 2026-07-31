/// <reference types="vite/client" />

interface ImportMetaEnv{readonly VITE_TURNSTILE_SITE_KEY?:string}
interface ImportMeta{readonly env:ImportMetaEnv}
interface Window{turnstile?:{render(container:HTMLElement,options:{sitekey:string;theme:'light';size:'flexible';appearance:'interaction-only';action:string;callback:(token:string)=>void;'expired-callback':()=>void;'error-callback':()=>void}):string;remove(widgetId:string):void}}
