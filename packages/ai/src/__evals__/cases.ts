/**
 * Estes scripts documentam o contrato feliz; regressão de prompt não é medida aqui.
 * The eval measures the harness + guardrail + sources, not model intelligence.
 */

import type { EvalCase } from './types';

export const cases: EvalCase[] = [
  {
    id: 'eval.revenue-this-month',
    question: 'Quanto vendemos este mês?',
    script: [
      { toolCalls: [{ name: 'get_revenue' }] },
      { text: 'A receita do mês foi de R$ 1.500.' },
    ],
    expect: {
      tools: ['get_revenue'],
      sourcesNonEmpty: true,
      forbidden: ['999.999'],
    },
  },
  {
    id: 'eval.best-product',
    question: 'Qual foi nosso melhor produto?',
    script: [
      { toolCalls: [{ name: 'get_products' }] },
      { text: 'O melhor produto foi Plano Pro, com R$ 1.500.' },
    ],
    expect: { tools: ['get_products'] },
  },
  {
    id: 'eval.top-seller',
    question: 'Quem mais vendeu?',
    script: [
      { toolCalls: [{ name: 'get_sellers' }] },
      { text: 'Ana lidera as vendas, com R$ 1.500.' },
    ],
    expect: { tools: ['get_sellers'] },
  },
  {
    id: 'eval.why-drop',
    question: 'Por que nossas vendas caíram?',
    script: [
      { toolCalls: [{ name: 'explain_change' }, { name: 'get_revenue' }] },
      { text: 'A receita caiu para R$ 1.500 no período.' },
    ],
    expect: { tools: ['explain_change'] },
  },
  {
    id: 'eval.customers-buying-less',
    question: 'Quais clientes estão comprando menos?',
    script: [
      { toolCalls: [{ name: 'get_customers' }] },
      { text: 'Há clientes recorrentes comprando menos neste mês.' },
    ],
    expect: { tools: ['get_customers'] },
  },
  {
    id: 'eval.prioritize-today',
    question: 'O que devo priorizar hoje?',
    script: [
      { toolCalls: [{ name: 'get_insights' }] },
      { text: 'Priorize os insights abertos de receita.' },
    ],
    expect: { tools: ['get_insights'] },
  },
  {
    id: 'eval.hallucinated-revenue',
    question: 'Quanto vendemos?',
    script: [{ text: 'A receita foi de R$ 999.999.' }],
    context: { metrics: [], insights: [], sources: [] },
    expect: {
      guardrail: 'unsourced_numbers',
      forbidden: ['999.999'],
    },
  },
  {
    id: 'eval.viewer-no-propose',
    question: 'Crie uma tarefa para ligar para o cliente',
    role: 'viewer',
    script: [
      {
        toolCalls: [
          {
            name: 'propose_action',
            input: { actionType: 'create_task', input: { title: 'Ligar para o cliente' } },
          },
        ],
      },
      { text: 'Não posso registrar essa ação com o seu perfil.' },
    ],
    expect: { noProposals: true },
  },
  {
    id: 'E16: document source does not satisfy revenue claim',
    question: 'Quanto vendemos segundo o PDF?',
    script: [
      { toolCalls: [{ name: 'search_documents', input: { query: 'receita' } }] },
      { text: 'Vendemos R$ 10.000.000.' },
    ],
    context: { metrics: [], insights: [], sources: [] },
    expect: {
      tools: ['search_documents'],
      guardrail: ['unsourced_numbers', 'claim_mismatch'],
    },
  },
];
