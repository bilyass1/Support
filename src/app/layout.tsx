import type { Metadata,Viewport } from 'next';
import { Pwa } from '@/components/pwa';
import './globals.css';
export const metadata:Metadata={title:'SupportFlow — Espace client',description:'Demandes, facturation, messagerie et suivi de vos applications.',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'SupportFlow',statusBarStyle:'default'},icons:{icon:'/icon.svg',apple:'/icon-192.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:[{media:'(prefers-color-scheme: light)',color:'#f4f6fb'},{media:'(prefers-color-scheme: dark)',color:'#0e1220'}]};
// Applied before first paint so the saved theme never flashes.
const theme=`try{var t=localStorage.getItem('supportflow:theme:v1')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}`;
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="fr" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:theme}}/></head><body>{children}<Pwa/></body></html>;}
