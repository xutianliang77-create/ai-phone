import {emptyConfiguration,mergeConfiguration,publicConfiguration} from "./public-model-config.js";
import {encryptedModelConfigStore} from "./encrypted-model-config-store.js";
const store=encryptedModelConfigStore({kind:"public",deploymentEnv:"API_RESULT_SYNC_DEPLOYMENT_ID",empty:emptyConfiguration,merge:mergeConfiguration,present:publicConfiguration});
export const readPublicModelConfiguration=store.read;
export const savePublicModelConfiguration=store.save;
export const selectPublicModelConfigurationInternal=store.selectInternal;
