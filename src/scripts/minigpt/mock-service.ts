// src/scripts/minigpt/mock-service.ts

export interface StreamCallbacks {
  onStart?: () => void;
  onToken?: (token: string, fullText: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Endpoint de inferencia para el futuro backend FastAPI.
 * Cuando el modelo esté entrenado y desplegado en tu VPS, basta con asignar la URL:
 * ej. 'https://api.tudominio.com/v1/chat/completions'
 */
export const FASTAPI_INFERENCE_URL: string | null = null;

interface KnowledgeTopic {
  keywords: string[];
  response: string;
}

const KNOWLEDGE_BASE: KnowledgeTopic[] = [
  {
    keywords: ['atención', 'atencion', 'attention', 'causal', 'self-attention', 'fórmula', 'formula'],
    response: `### Causal Self-Attention en miniGPT

En **miniGPT**, la atención causal asegura que cada token solo pueda atender a tokens previos en la secuencia temporal ($t' \le t$), preservando la propiedad autoregresiva para la generación de texto.

La fórmula clásica de atención escalada por producto punto es:

$$Attention(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}} + M\\right)V$$

donde $M$ es la matriz triangular causal de máscara definida como:

$$M_{i,j} = \\begin{cases} 0 & \\text{si } i \\ge j \\\\ -\\infty & \\text{si } i < j \\end{cases}$$

Implementación del módulo en PyTorch:

\`\`\`python
import math
import torch
import torch.nn as nn
import torch.nn.functional as F

class CausalSelfAttention(nn.Module):
    def __init__(self, config):
        super().__init__()
        assert config.n_embd % config.n_head == 0
        self.n_head = config.n_head
        self.n_embd = config.n_embd
        
        # Proyecciones lineales conjuntas para Q, K, V
        self.c_attn = nn.Linear(config.n_embd, 3 * config.n_embd)
        # Proyección de salida
        self.c_proj = nn.Linear(config.n_embd, config.n_embd)
        
        # Buffer de máscara causal (no entrenable)
        self.register_buffer(
            "bias",
            torch.tril(torch.ones(config.block_size, config.block_size))
            .view(1, 1, config.block_size, config.block_size)
        )

    def forward(self, x):
        B, T, C = x.size() # Batch, Time, Channels
        
        # Calcular Q, K, V en un solo paso y reorganizar cabezales
        q, k, v = self.c_attn(x).split(self.n_embd, dim=2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)

        # Scaled dot-product attention
        att = (q @ k.transpose(-2, -1)) * (1.0 / math.sqrt(k.size(-1)))
        att = att.masked_fill(self.bias[:, :, :T, :T] == 0, float('-inf'))
        att = F.softmax(att, dim=-1)
        
        y = att @ v # (B, nh, T, hs)
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.c_proj(y)
\`\`\`

Esta implementación utiliza vectores vectorizados en batch para maximizar la velocidad de cómputo en CUDA.`
  },
  {
    keywords: ['arquitectura', 'architecture', 'parametros', 'parámetros', 'capas', 'layers', 'especificaciones'],
    response: `### Especificaciones de Arquitectura de miniGPT

**miniGPT** es un transformador autoregresivo (*decoder-only*) concebido para estudiar los principios fundamentales de los modelos de lenguaje:

1. **Configuración de hiperparámetros:**
   - **Dimensiones de embedding ($n_{embd}$):** \`384\`
   - **Número de bloques transformadores ($n_{layer}$):** \`6\`
   - **Número de cabezales de atención ($n_{head}$):** \`6\` (dimensión por cabeza $d_k = 64$)
   - **Longitud máxima de contexto ($block\\_size$):** \`1024\` tokens
   - **Vocabulario ($vocab\\_size$):** \`50,257\` (codificación BPE tipo GPT-2)
   - **Volumen de parámetros:** $\\approx 15.2\\text{M}$ parámetros entrenables

2. **Normalización y Activación:**
   - **Pre-LayerNorm:** Las capas de normalización se aplican antes de los bloques de atención y MLP (arquitectura moderna tipo GPT-2 / LLaMA), lo que estabiliza el gradiente en entrenamientos profundos.
   - **Función de activación:** GELU aproximada (Gaussian Error Linear Unit).

\`\`\`python
class Block(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.ln_1 = nn.LayerNorm(config.n_embd)
        self.attn = CausalSelfAttention(config)
        self.ln_2 = nn.LayerNorm(config.n_embd)
        self.mlp = MLP(config)

    def forward(self, x):
        x = x + self.attn(self.ln_1(x))
        x = x + self.mlp(self.ln_2(x))
        return x
\`\`\`

Todo el código está diseñado modularmente para ser ejecutado eficientemente tanto en CPUs modernas como en aceleradores GPU con soporte float16 / bfloat16.`
  },
  {
    keywords: ['entrenamiento', 'training', 'loss', 'optimizador', 'dataset', 'adamw'],
    response: `### Pipeline de Entrenamiento y Función de Pérdida

El entrenamiento de miniGPT se basa en el objetivo de **modelado de lenguaje autoregresivo** (predecir el siguiente token dada la historia previa):

$$\\mathcal{L}_{CLM}(\\theta) = -\\frac{1}{T} \\sum_{t=1}^T \\log P_\\theta(x_t \\mid x_1, x_2, \\dots, x_{t-1})$$

Detalles del ciclo de optimización:
- **Optimizador:** AdamW con $\\beta_1 = 0.9$, $\\beta_2 = 0.95$ y decaimiento de pesos (*weight decay*) de $0.1$.
- **Learning Rate Schedule:** Warmup lineal durante las primeras 2000 iteraciones, seguido de un decaimiento por coseno (*Cosine Annealing*) hasta el 10% del ratio inicial.
- **Gradient Clipping:** Recorte de norma de gradiente a $1.0$ para mitigar explosiones numéricas en capas profundas.

Fragmento del ciclo en PyTorch:
\`\`\`python
optimizer = torch.optim.AdamW(model.parameters(), lr=6e-4, betas=(0.9, 0.95), weight_decay=0.1)

for step, (x, y) in enumerate(dataloader):
    optimizer.zero_grad(set_to_none=True)
    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
        logits, loss = model(x, targets=y)
    
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
    optimizer.step()
\`\`\`
`
  },
  {
    keywords: ['pytorch', 'código', 'codigo', 'implementar', 'decoder'],
    response: `### Modelo Completo miniGPT en PyTorch

Aquí tienes la clase principal que orquesta los embeddings posicionales, los bloques residuales y la proyección final al vocabulario:

\`\`\`python
class MiniGPT(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.transformer = nn.ModuleDict(dict(
            wte = nn.Embedding(config.vocab_size, config.n_embd),
            wpe = nn.Embedding(config.block_size, config.n_embd),
            h = nn.ModuleList([Block(config) for _ in range(config.n_layer)]),
            ln_f = nn.LayerNorm(config.n_embd),
        ))
        self.lm_head = nn.Linear(config.n_embd, config.vocab_size, bias=False)
        # Weight tying (compartición de pesos entre wte y lm_head)
        self.transformer.wte.weight = self.lm_head.weight

    def forward(self, idx, targets=None):
        B, T = idx.size()
        pos = torch.arange(0, T, dtype=torch.long, device=idx.device)
        
        # Suma de token embedding y positional embedding
        tok_emb = self.transformer.wte(idx)
        pos_emb = self.transformer.wpe(pos)
        x = tok_emb + pos_emb
        
        for block in self.transformer.h:
            x = block(x)
        x = self.transformer.ln_f(x)

        if targets is not None:
            logits = self.lm_head(x)
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1))
            return logits, loss
        else:
            logits = self.lm_head(x[:, [-1], :])
            return logits, None
\`\`\`

Esta estructura replica con precisión el diseño de la arquitectura GPT-2 manteniendo un código legible y pedagógico.`
  }
];

const DEFAULT_RESPONSE_ES = `¡Hola! Soy **miniGPT**, un modelo de lenguaje autoregresivo construido e implementado desde cero en **PyTorch**.

Actualmente estoy en fase de pre-entrenamiento local. Puedes preguntarme sobre:
- **Arquitectura:** Bloques residuales, embeddings, número de capas y cabezales.
- **Atención Causal:** Fórmulas matemáticas y la implementación de la matriz de atención con máscara triangular.
- **Pipeline de Entrenamiento:** Optimizador AdamW, función de pérdida Cross-Entropy y cosine learning rate schedule.
- **Implementación en PyTorch:** Módulos de red neuronal y scripts de entrenamiento.

¿Qué aspecto te gustaría explorar hoy?`;

const DEFAULT_RESPONSE_EN = `Hello! I'm **miniGPT**, an autoregressive small language model built from scratch in **PyTorch**.

I am currently in local pre-training mode. Feel free to ask me about:
- **Architecture:** Residual blocks, embedding dimensions, layer counts, and attention heads.
- **Causal Attention:** Mathematical formulas and triangular masked attention implementation.
- **Training Pipeline:** AdamW optimizer, Cross-Entropy loss, and cosine learning rate schedule.
- **PyTorch Implementation:** Source code modules, LayerNorm, and training loops.

What area would you like to explore today?`;

export class MiniGptService {
  private isGenerating = false;
  private abortRequested = false;

  public async streamChat(
    userMessage: string,
    locale: 'es' | 'en',
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (this.isGenerating) {
      this.abortRequested = true;
      await new Promise((r) => setTimeout(r, 100));
    }

    this.isGenerating = true;
    this.abortRequested = false;

    callbacks.onStart?.();

    // Si en el futuro FASTAPI_INFERENCE_URL está configurado, llamamos a la API real
    if (FASTAPI_INFERENCE_URL) {
      try {
        await this.streamFromFastAPI(userMessage, callbacks);
      } catch (err) {
        callbacks.onError?.(err as Error);
      } finally {
        this.isGenerating = false;
      }
      return;
    }

    // Modo simulación local pedagógica con tokens progresivos
    await this.streamLocalSimulation(userMessage, locale, callbacks);
    this.isGenerating = false;
  }

  public stopGeneration(): void {
    this.abortRequested = true;
  }

  private async streamLocalSimulation(
    query: string,
    locale: 'es' | 'en',
    callbacks: StreamCallbacks
  ): Promise<void> {
    const qLower = query.toLowerCase();

    // Buscar coincidencia en la base de conocimiento
    let matchedTopic = KNOWLEDGE_BASE.find((k) =>
      k.keywords.some((w) => qLower.includes(w))
    );

    let fullAnswer = matchedTopic
      ? matchedTopic.response
      : locale === 'en'
      ? DEFAULT_RESPONSE_EN
      : DEFAULT_RESPONSE_ES;

    // Simular latencia de red inicial (Time-to-first-token: 250-450ms)
    await new Promise((r) => setTimeout(r, 320));

    if (this.abortRequested) return;

    // Partir la respuesta en chunks de palabras/tokens
    const tokens = fullAnswer.match(/(\s+|\S+)/g) || [fullAnswer];
    let accumulated = '';

    for (let i = 0; i < tokens.length; i++) {
      if (this.abortRequested) break;

      const token = tokens[i];
      accumulated += token;
      callbacks.onToken?.(token, accumulated);

      // Variación sutil de velocidad de streaming (entre 15ms y 40ms por chunk)
      const delay = Math.floor(Math.random() * 25) + 15;
      await new Promise((r) => setTimeout(r, delay));
    }

    if (!this.abortRequested) {
      callbacks.onComplete?.(accumulated);
    }
  }

  private async streamFromFastAPI(
    prompt: string,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const response = await fetch(FASTAPI_INFERENCE_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';

    while (true) {
      if (this.abortRequested) {
        await reader.cancel();
        break;
      }

      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulated += chunk;
      callbacks.onToken?.(chunk, accumulated);
    }

    callbacks.onComplete?.(accumulated);
  }
}
