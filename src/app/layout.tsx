import type { Metadata,Viewport } from 'next';
import { Pwa } from '@/components/pwa';
import './globals.css';
export const metadata:Metadata={title:'SupportFlow — Votre espace de collaboration',description:'Gérez vos applications, demandes de développement et crédits de support.',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'SupportFlow',statusBarStyle:'default'},icons:{icon:'/icon.svg',apple:'/icon-192.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#153e35'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="fr"><body>{children}<Pwa/></body></html>;}
