import type { Metadata,Viewport } from 'next';
import { ThemeInitializer } from '@/components/theme-initializer';
import './globals.css';
export const metadata:Metadata={title:'Solumove Support — Votre espace client',description:'Gérez vos applications, demandes de développement et crédits de support.',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Solumove',statusBarStyle:'default'},icons:{icon:[{url:'/icon.svg?v=2',type:'image/svg+xml'},{url:'/icon-192.png?v=2',type:'image/png'}],apple:'/apple-touch-icon.png?v=2'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#101c36'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="fr"><body><ThemeInitializer/>{children}</body></html>;}

