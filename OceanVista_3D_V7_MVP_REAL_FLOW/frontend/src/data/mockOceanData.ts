export const depths=[0,50,100,200,500,1000,2000];
export type ProfileRow={depth:number;observed:number;model:number};
const base:ProfileRow[]=[{depth:0,observed:29,model:29.4},{depth:100,observed:23.5,model:22.8},{depth:500,observed:10.2,model:10.4},{depth:1000,observed:6.2,model:6.0},{depth:2000,observed:4,model:3.8}];
const vary=(a:number,b:number)=>base.map((r,i)=>({...r,observed:+(r.observed+a*Math.sin(i+1)).toFixed(1),model:+(r.model+b*Math.cos(i+1)).toFixed(1)}));
export const profiles:Record<string,ProfileRow[]>={
 '2903671':base,
 '2904120':vary(.35,.28),
 '2905214':vary(.6,.42),
 '2906382':vary(.8,.55),
 SG678:[{depth:0,observed:28.5,model:28.9},{depth:100,observed:22.7,model:23.2},{depth:500,observed:11.1,model:10.5},{depth:1000,observed:6.8,model:6.4},{depth:2000,observed:3.9,model:4.2}]
};
export const instruments:Record<string,{type:'Argo Float'|'Glider';lat:number;lon:number;maxDepth:number;quality:string}>={
 '2903671':{type:'Argo Float',lat:17.85,lon:86.41,maxDepth:2000,quality:'Good'},
 '2904120':{type:'Argo Float',lat:15.10,lon:88.20,maxDepth:1800,quality:'Good'},
 '2905214':{type:'Argo Float',lat:13.72,lon:85.92,maxDepth:2000,quality:'Good'},
 '2906382':{type:'Argo Float',lat:16.40,lon:89.30,maxDepth:1500,quality:'Suspect'},
 SG678:{type:'Glider',lat:14.40,lon:87.10,maxDepth:1000,quality:'Good'}
};
