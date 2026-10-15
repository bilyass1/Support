'use client';
import {useEffect} from 'react';
export function ThemeInitializer(){useEffect(()=>{try{const theme=localStorage.getItem('supportflow:theme:v1');document.documentElement.dataset.theme=theme==='light'||theme==='dark'?theme:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{document.documentElement.dataset.theme='light';}},[]);return null;}
