import type {Pool} from 'pg';
export async function validateAppleAccountState(pool:Pick<Pool,'query'>){
 const result=await pool.query<{apple_namespace_ready:boolean;conflict_directive_preserved:boolean}>(`
  WITH source AS (
    SELECT pg_get_functiondef('ai_phone.apply_product_record_projection_event(text,text,text,text,jsonb)'::regprocedure) AS definition
  ) SELECT position(quote_literal('appleAuthStates') IN definition)>0 AS apple_namespace_ready,
    position('#variable_conflict use_column' IN definition)>0 AS conflict_directive_preserved FROM source
 `);
 const row=result.rows[0];
 if(row?.apple_namespace_ready!==true||row?.conflict_directive_preserved!==true)throw new Error('Apple account projection validation failed');
 return {migration:'042_apple_account_state',details:{appleNamespaceReady:true,conflictDirectivePreserved:true}};
}
