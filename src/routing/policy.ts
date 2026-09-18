import { CatalogModel, RoutingPolicy, RouteDecision, TaskProfile } from '../core/types.js';
import { Health, isMetaRouter, parameterBillions, accountOf } from './rank.js';

export class PolicyEngine {
  constructor(private health: Health) {}

  evaluate(models: CatalogModel[], task: TaskProfile, policy: RoutingPolicy): RouteDecision[] {
    const decisions: RouteDecision[] = [];

    for (const model of models) {
      if (policy.requirements?.local_only && !model.provider.local) continue;
      if (policy.requirements?.tools && model.capabilities.tools === false) continue;
      if (policy.requirements?.vision && model.capabilities.vision === false) continue;
      if (policy.requirements?.context && (model.contextLength ?? 0) < policy.requirements.context) continue;

      const account = accountOf(model.provider);
      if (this.health.coolingUntil(account, model.model)) continue;

      const size = parameterBillions(model.model);
      const ttft = this.health.peek(account, model.model)?.ttftMs ?? 1000;
      
      let latencyScore = Math.max(0, 1 - (ttft / 5000));
      let qualityScore = size ? Math.min(1, Math.max(0, Math.log10(size) / 3)) : 0.5;
      let costScore = model.price === 'zero-price' ? 1.0 : (model.price === 'local' ? 0.9 : 0.2);

      let total = 0;
      let reason = 'balanced';

      switch (policy.strategy) {
        case 'lowest-cost':
          total = costScore * 0.8 + qualityScore * 0.2;
          reason = 'lowest-cost';
          break;
        case 'lowest-latency':
          total = latencyScore * 0.7 + qualityScore * 0.3;
          reason = 'lowest-latency';
          break;
        case 'highest-quality':
          total = qualityScore * 0.8 + latencyScore * 0.2;
          reason = 'highest-quality';
          break;
        case 'local-first':
          total = (model.provider.local ? 0.8 : 0) + qualityScore * 0.2;
          reason = 'local-first';
          break;
        case 'hedged':
          total = qualityScore * 0.5 + latencyScore * 0.5;
          reason = 'hedged';
          break;
        case 'reasoning-budget':
          total = qualityScore * 0.6 + costScore * 0.4;
          reason = 'reasoning-budget';
          break;
        case 'balanced':
        default:
          total = qualityScore * 0.4 + latencyScore * 0.3 + costScore * 0.3;
          break;
      }

      if (isMetaRouter(model.model)) {
        total -= 10; 
      }

      decisions.push({
        provider: model.provider.id,
        model: model.model,
        score: {
          latency: latencyScore,
          cost: costScore,
          quality: qualityScore,
          total
        },
        reason,
        alternatives: [] // Filled in post-sort
      });
    }

    decisions.sort((a, b) => b.score.total - a.score.total);
    decisions.forEach((d, i) => {
      d.alternatives = decisions.slice(i + 1, i + 4).map(alt => ({ provider: alt.provider, model: alt.model, score: alt.score.total }));
    });

    return decisions;
  }
}
