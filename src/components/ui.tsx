'use client';
export function downloadCsv(name:string,header:string[],rows:(string|number|null|undefined)[][]) {
  // Cells starting with a formula character are prefixed so spreadsheets never execute them.
  const cell=(value:string|number|null|undefined)=>{const text=String(value??'');return '"'+(/^[=+\-@\t\r]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';};
  const blob=new Blob(['﻿'+[header,...rows].map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name+'.csv';link.click();URL.revokeObjectURL(link.href);
}
