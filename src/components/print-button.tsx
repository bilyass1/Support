'use client';
import { Printer } from 'lucide-react';
export function PrintButton(){return <button className="primary" onClick={()=>window.print()}><Printer size={16}/>Imprimer / enregistrer en PDF</button>;}
