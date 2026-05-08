/**
 * 測試新的 ActionButtonManager 伺服器端支援
 *
 * 這個測試模組用於驗證：
 * 1. BaseModule 正確生成 actionConfig
 * 2. actionConfig 正確通過 stage_started 事件發送到客戶端
 * 3. 各種 stage 類型的 actionConfig 格式正確
 */

const BaseModule = require('../core/BaseModule');

class TestActionConfigModule extends BaseModule {
  constructor(manifest, session, config) {
    super(manifest, session, config);
    this.receivedConfigs = [];
  }

  /**
   * 攔截 stage_started 事件來記錄 actionConfig
   */
  async _startCurrentStage(session) {
    const result = await super._startCurrentStage(session);

    // 記錄生成的 actionConfig
    const stage = this._currentStage();
    if (stage) {
      const actionConfig = this._generateActionConfig(stage, session);
      this.receivedConfigs.push({
        stageId: stage.id,
        stageType: stage.type,
        stageName: stage.name,
        actionConfig: actionConfig
      });

      console.log('[TestActionConfigModule] Generated actionConfig for stage:', stage.id);
      console.log('[TestActionConfigModule] Stage type:', stage.type);
      console.log('[TestActionConfigModule] Action config:', JSON.stringify(actionConfig, null, 2));
    }

    return result;
  }

  /**
   * 獲取所有記錄的配置
   */
  getReceivedConfigs() {
    return this.receivedConfigs;
  }

  /**
   * 獲取特定 stage 的配置
   */
  getConfigForStage(stageId) {
    return this.receivedConfigs.find(config => config.stageId === stageId);
  }

  /**
   * 驗證 actionConfig 格式
   */
  validateActionConfig(stageType, actionConfig) {
    const errors = [];

    if (!actionConfig) {
      errors.push('actionConfig is null or undefined');
      return { valid: false, errors };
    }

    // 驗證必需的欄位
    if (!actionConfig.uiMode) {
      errors.push('Missing uiMode');
    }

    if (!actionConfig.selection) {
      errors.push('Missing selection config');
    } else {
      if (actionConfig.selection.source === undefined) {
        errors.push('Missing selection.source');
      }
      if (actionConfig.selection.multiSelect === undefined) {
        errors.push('Missing selection.multiSelect');
      }
    }

    if (!actionConfig.actions || !Array.isArray(actionConfig.actions)) {
      errors.push('Missing or invalid actions array');
    } else {
      // 驗證每個 action
      actionConfig.actions.forEach((action, index) => {
        if (!action.id) {
          errors.push(`Action ${index} missing id`);
        }
        if (!action.type) {
          errors.push(`Action ${index} missing type`);
        }
        if (!action.behavior) {
          errors.push(`Action ${index} missing behavior`);
        } else {
          if (!action.behavior.action) {
            errors.push(`Action ${index} missing behavior.action`);
          }
        }
        if (!action.states || typeof action.states !== 'object') {
          errors.push(`Action ${index} missing or invalid states`);
        }
      });
    }

    // 針對特定 stage 類型的驗證
    if (stageType === 'vote') {
      if (!actionConfig.voteConfig) {
        errors.push('Vote stage missing voteConfig');
      }
      if (!actionConfig.voteOptions || !Array.isArray(actionConfig.voteOptions)) {
        errors.push('Vote stage missing or invalid voteOptions');
      }
      if (!actionConfig.eligibleVoters || !Array.isArray(actionConfig.eligibleVoters)) {
        errors.push('Vote stage missing or invalid eligibleVoters');
      }
    }

    if (stageType === 'game') {
      if (!actionConfig.controllerLayout) {
        errors.push('Game stage missing controllerLayout');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 印出測試結果
   */
  printTestResults() {
    console.log('\n========== ACTION CONFIG 測試結果 ==========');

    this.receivedConfigs.forEach((config, index) => {
      console.log(`\n--- Stage ${index + 1}: ${config.stageName} (${config.stageType}) ---`);
      console.log('Stage ID:', config.stageId);

      const validation = this.validateActionConfig(config.stageType, config.actionConfig);

      if (validation.valid) {
        console.log('✅ actionConfig 格式正確');
      } else {
        console.log('❌ actionConfig 格式錯誤:');
        validation.errors.forEach(error => {
          console.log('  -', error);
        });
      }

      console.log('\n生成的 actionConfig:');
      console.log(JSON.stringify(config.actionConfig, null, 2));
    });

    console.log('\n==============================================');
  }
}

module.exports = TestActionConfigModule;