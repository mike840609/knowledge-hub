import {expect,it} from "vitest";
import {assessImportSafety} from "@/modules/sources/domain/import-safety";
const assess=(previousDocuments:number,incomingDocuments:number,matchedDocuments:number,archivedDocuments:number)=>assessImportSafety({previousDocuments,incomingDocuments,matchedDocuments,archivedDocuments});
it("requires archive count and ratio together at the exact thresholds",()=>{
 expect(assess(20,15,15,5).highRisk).toBe(false);expect(assess(20,14,14,6).highRisk).toBe(true);
 expect(assess(100,95,95,5).highRisk).toBe(false);
});
it("guards empty input and complete archives even for small sources",()=>{
 expect(assess(1,0,0,1).highRisk).toBe(true);expect(assess(2,2,0,2).highRisk).toBe(true);expect(assess(0,5,0,0).highRisk).toBe(false);
});
it("guards low overlap but does not penalize confirmed stable moves",()=>{
 expect(assess(5,5,0,1).highRisk).toBe(true);expect(assess(5,5,1,1).highRisk).toBe(false);
 expect(assess(10,10,10,0).highRisk).toBe(false);
 expect(assess(5,5,0,0).highRisk).toBe(false);
});
