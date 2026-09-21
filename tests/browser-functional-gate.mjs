// Functional gate: UI-only assertions. Run after a fresh localhost load.
export async function runFunctionalGate(page) {
 const button=name=>page.getByRole('button',{name,exact:true});
 const click=async name=>button(name).click();
 const text=async value=>{const s=page.domSnapshot?await page.domSnapshot():await page.locator('body').innerText();if(!s.includes(value))throw Error('Missing '+value)};
 const requireEnabled=async(name,expected)=>{if(await button(name).isEnabled()!==expected)throw Error('Wrong enabled state: '+name)};
 const slot=()=>page.getByRole('row').filter({hasText:'9 Supporting documents'});
 await page.getByRole('combobox',{name:'Scenario',exact:true}).selectOption({index:0});await click('Owner');await click('Reset scenario');
 await page.getByRole('searchbox',{name:'Search',exact:true}).fill('no-such-case');await text('No cases match these filters');await button('Clear filters').first().click();
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption({label:'Ready for launch'});await text('No cases match these filters');await button('Clear filters').first().click();
 await click('Open case');await requireEnabled('Save draft',false);await slot().getByRole('button',{name:'Add document',exact:true}).click();
 await page.getByRole('radio',{name:'Mark not applicable Use when the document genuinely does not exist for this case. A reason is required.',exact:true}).check();await click('Apply to slot');await text('A reason is required before a slot can be marked not applicable.');
 await page.getByRole('textbox',{name:'Reason *',exact:true}).fill('No supporting document applies to this synthetic case.');await click('Apply to slot');await requireEnabled('Save draft',true);await click('Discard changes');if(!(await slot().innerText()).includes('Not yet provided'))throw Error('Discard did not restore slot');
 await slot().getByRole('button',{name:'Add document',exact:true}).click();await page.getByRole('radio',{name:'ModelCard_synthetic.md Optional context. This slot gates no lane. Clean',exact:true}).check();await click('Apply to slot');await click('Save draft');await requireEnabled('Save draft',false);
 await slot().getByRole('button',{name:'Change',exact:true}).click();await page.getByRole('radio',{name:'Record as missing Use when the document should exist and does not. Different from “not yet provided”.',exact:true}).check();await click('Apply to slot');if(!(await slot().innerText()).includes('Recorded as missing'))throw Error('Missing not applied');await click('Discard changes');if(!(await slot().innerText()).includes('ModelCard_synthetic.md'))throw Error('Saved slot lost');
 await click('Medium (proposed) — view evidence');await page.getByRole('radio',{name:'Incomplete evidence One or more of the evidence rows is not stated, so no tier can be proposed. Unknown',exact:true}).check();await click('Close');await click('Unknown (proposed) — view evidence');await page.getByRole('radio',{name:'Customer-facing, no human review at answer time Direct customer interaction with possible special-category free text and no reviewer in the loop. High',exact:true}).check();await text('High means the Council confirms the tier.');await click('Close');
 await click('Run checks & submit');await click('Submit anyway');await text('In review · 3 lanes open');await page.getByRole('tab',{name:/History/}).click();await click('View snapshot');await text('Snapshots are written once at submission and never edited.');await text('ModelCard_synthetic.md');await click('Close dialog');
 await page.getByRole('button',{name:/^Notifications,/}).click();await text('Three review lanes opened');await click('Open RAI-2026-0147');await text('Churn Propensity Scoring');
 for(const role of ['Owner','BU SPOC','Admin','AI/COE','DPO','IT/Security']){await click(role);await page.getByRole('tab',{name:'Review lanes 3',exact:true}).click();let n=0;for(const b of await button('Approve lane').all())if(await b.isEnabled())n++;if(n!==(['AI/COE','DPO','IT/Security'].includes(role)?1:0))throw Error('Wrong approval scope '+role)}
 await click('Admin');await click('Administration');await page.getByRole('spinbutton',{name:'Privacy (DPO) lane',exact:true}).fill('-1');await requireEnabled('Publish revision',false);await text('SLA values must be positive whole working days.');await click('Discard edits');
 await page.getByRole('textbox',{name:'Pack template version',exact:true}).fill(' ');await requireEnabled('Publish revision',false);await text('Enter a pack template version.');await click('Discard edits');
 await page.getByRole('spinbutton',{name:'High band',exact:true}).fill('4');await requireEnabled('Publish revision',false);await text('Thresholds must satisfy');await click('Discard edits');
 await page.getByRole('spinbutton',{name:'Privacy (DPO) lane',exact:true}).fill('4');await requireEnabled('Publish revision',true);await click('Publish revision');await text('Rev 4 · pack template 1.4');await click('Owner');await click('Reset scenario');return {filters:'PASS',slotValidation:'PASS',saveDiscard:'PASS',risk:'PASS',snapshot:'PASS',notificationLink:'PASS',sixRoles:'PASS',adminValidation:'PASS'};
}

export async function runDispositionChecks(page){
 const b=name=>page.getByRole('button',{name,exact:true});
 const text=async v=>{const s=page.domSnapshot?await page.domSnapshot():await page.locator('body').innerText();if(!s.includes(v))throw Error('Missing '+v)};
 for(const kind of ['fixed','na']){
  await page.getByRole('combobox',{name:'Scenario',exact:true}).selectOption({index:1});await b('Dispose').click();await b('Record disposition').click();await text('Fixing a finding needs an evidence panel behind it.');
  if(kind==='fixed'){
   await page.getByRole('textbox',{name:'What changed',exact:true}).fill('Synthetic reviewer attestation for the selected evidence panel.');await b('Record disposition').click();await text('Fixing a finding needs an evidence panel behind it.');await page.getByRole('combobox',{name:'Evidence that closes it *',exact:true}).selectOption({label:'Privacy checklist · PrivacyChecklist_v1.0.xlsx'});
  }else{
   await page.getByRole('radio',{name:'Not applicable with reason The check does not apply to this case. The reason is mandatory.',exact:true}).check();await b('Record disposition').click();await text('at least 20 characters');await page.getByRole('textbox',{name:'Reason (required)',exact:true}).fill('Synthetic demo exception with explicitly recorded reviewer rationale.');
  }
  await b('Record disposition').click();await text('every finding on Submission v1 is disposed.');
 }
 await page.getByRole('combobox',{name:'Scenario',exact:true}).selectOption({index:0});await b('Owner').click();await b('Reset scenario').click();return {fixedEvidence:'PASS',naReason:'PASS',readiness:'PASS'};
}
