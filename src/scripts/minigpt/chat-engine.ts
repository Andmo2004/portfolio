// src/scripts/minigpt/chat-engine.ts
import { MiniGptService } from './mock-service';

export interface ChatEngineOptions {
  locale: 'es' | 'en';
}

export function initMiniGptChat(options: ChatEngineOptions) {
  const { locale } = options;
  const service = new MiniGptService();

  // Elementos DOM
  const streamEl = document.getElementById('message-stream');
  const inputEl = document.getElementById('minigpt-input') as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById('minigpt-send') as HTMLButtonElement | null;
  const emptyStateEl = document.getElementById('empty-state');
  const clearBtn = document.getElementById('btn-clear-chat');
  const newBtn = document.getElementById('btn-new-chat');

  // Elementos Sidebar Off-Canvas
  const sidebarEl = document.getElementById('minigpt-sidebar');
  const sidebarScrimEl = document.getElementById('sidebar-scrim');
  const openSidebarBtn = document.getElementById('btn-open-sidebar');
  const closeSidebarBtn = document.getElementById('btn-close-sidebar');

  if (!streamEl || !inputEl || !sendBtn) return;

  let lastUserQuery = '';

  // Auto-expansión y validación del textarea
  function adjustTextarea() {
    if (!inputEl || !sendBtn) return;
    inputEl.style.height = 'auto';
    const newHeight = Math.min(inputEl.scrollHeight, 200);
    inputEl.style.height = `${newHeight}px`;

    const hasText = inputEl.value.trim().length > 0;
    sendBtn.disabled = !hasText;
  }

  inputEl.addEventListener('input', adjustTextarea);

  // Atajos de teclado en el textarea
  inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) {
        handleSend();
      }
    }
  });

  sendBtn.addEventListener('click', () => {
    handleSend();
  });

  // Prompt chips
  document.querySelectorAll<HTMLButtonElement>('.prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const query = chip.dataset.query || chip.innerText;
      if (inputEl) {
        inputEl.value = query;
        adjustTextarea();
        handleSend();
      }
    });
  });

  // Limpiar y Nueva conversación
  function resetConversation() {
    service.stopGeneration();
    const bubbles = streamEl?.querySelectorAll('.bubble, .bubble-group');
    bubbles?.forEach((b) => b.remove());
    if (emptyStateEl) emptyStateEl.style.display = 'flex';
    if (inputEl) {
      inputEl.value = '';
      adjustTextarea();
      inputEl.focus();
    }
  }

  clearBtn?.addEventListener('click', resetConversation);
  newBtn?.addEventListener('click', resetConversation);

  // Control de la Sidebar Off-Canvas
  function openSidebar() {
    if (!sidebarEl || !sidebarScrimEl) return;
    sidebarEl.setAttribute('data-open', 'true');
    sidebarScrimEl.setAttribute('data-open', 'true');
    sidebarEl.removeAttribute('inert');
    closeSidebarBtn?.focus();
    document.addEventListener('keydown', handleSidebarKeyDown);
  }

  function closeSidebar() {
    if (!sidebarEl || !sidebarScrimEl) return;
    sidebarEl.setAttribute('data-open', 'false');
    sidebarScrimEl.setAttribute('data-open', 'false');
    sidebarEl.setAttribute('inert', '');
    openSidebarBtn?.focus();
    document.removeEventListener('keydown', handleSidebarKeyDown);
  }

  function handleSidebarKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeSidebar();
    }
  }

  openSidebarBtn?.addEventListener('click', openSidebar);
  closeSidebarBtn?.addEventListener('click', closeSidebar);
  sidebarScrimEl?.addEventListener('click', closeSidebar);

  // Envío y gestión del flujo de mensajes
  async function handleSend() {
    if (!inputEl || !streamEl) return;
    const query = inputEl.value.trim();
    if (!query) return;

    lastUserQuery = query;
    inputEl.value = '';
    adjustTextarea();

    // Ocultar estado de bienvenida
    if (emptyStateEl) {
      emptyStateEl.style.display = 'none';
    }

    // 1. Agregar burbuja de usuario
    appendUserBubble(query);

    // 2. Crear burbuja de asistente con typing indicator
    const assistantBubble = createAssistantBubble();
    streamEl.appendChild(assistantBubble);
    scrollToBottom();

    const typingIndicator = assistantBubble.querySelector('.typing-indicator') as HTMLElement;
    const contentContainer = assistantBubble.querySelector('.bubble__content') as HTMLElement;

    // Deshabilitar input mientras genera
    inputEl.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    try {
      await service.streamChat(query, locale, {
        onStart: () => {
          if (typingIndicator) typingIndicator.style.display = 'flex';
        },
        onToken: (_token, accumulated) => {
          if (typingIndicator) typingIndicator.style.display = 'none';
          contentContainer.innerHTML = renderMarkdown(accumulated) + '<span class="minigpt-cursor" aria-hidden="true"></span>';
          attachCodeCopyListeners(contentContainer);
          scrollToBottom();
        },
        onComplete: (fullText) => {
          if (typingIndicator) typingIndicator.style.display = 'none';
          contentContainer.innerHTML = renderMarkdown(fullText);
          attachCodeCopyListeners(contentContainer);
          addAssistantActionBar(assistantBubble, fullText, query);
          scrollToBottom();
        },
        onError: () => {
          if (typingIndicator) typingIndicator.style.display = 'none';
          contentContainer.innerHTML = `<p class="bubble__error">${
            locale === 'en'
              ? 'An error occurred while generating the response.'
              : 'Ocurrió un error al generar la respuesta.'
          }</p>`;
        },
      });
    } finally {
      inputEl.disabled = false;
      inputEl.focus();
      adjustTextarea();
    }
  }

  function appendUserBubble(text: string) {
    if (!streamEl) return;
    const bubble = document.createElement('div');
    bubble.className = 'bubble bubble--user';
    bubble.textContent = text;
    streamEl.appendChild(bubble);
    scrollToBottom();
  }

  function createAssistantBubble(): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = 'bubble bubble--assistant';

    bubble.innerHTML = `
      <div class="typing-indicator" aria-label="${locale === 'en' ? 'Generating answer...' : 'Generando respuesta...'}">
        <span></span><span></span><span></span>
      </div>
      <div class="bubble__content"></div>
    `;

    return bubble;
  }

  function addAssistantActionBar(bubble: HTMLElement, fullText: string, originalQuery: string) {
    const existingBar = bubble.querySelector('.bubble__action-bar');
    if (existingBar) existingBar.remove();

    const bar = document.createElement('div');
    bar.className = 'bubble__action-bar';

    // Botón Copiar Mensaje
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'icon-button';
    copyBtn.setAttribute('title', locale === 'en' ? 'Copy answer' : 'Copiar respuesta');
    copyBtn.setAttribute('aria-label', locale === 'en' ? 'Copy answer' : 'Copiar respuesta');
    copyBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
    `;

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fullText);
        copyBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        `;
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
          `;
        }, 1500);
      } catch (err) {
        console.error('Error copying text:', err);
      }
    });

    // Botón Regenerar
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'icon-button';
    regenBtn.setAttribute('title', locale === 'en' ? 'Regenerate' : 'Regenerar');
    regenBtn.setAttribute('aria-label', locale === 'en' ? 'Regenerate' : 'Regenerar');
    regenBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    `;
    regenBtn.addEventListener('click', () => {
      bubble.remove();
      if (inputEl) {
        inputEl.value = originalQuery;
        adjustTextarea();
        handleSend();
      }
    });

    bar.appendChild(copyBtn);
    bar.appendChild(regenBtn);
    bubble.appendChild(bar);
  }

  function scrollToBottom() {
    if (!streamEl) return;
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  function attachCodeCopyListeners(container: HTMLElement) {
    container.querySelectorAll<HTMLButtonElement>('.code-copy-btn').forEach((btn) => {
      if (btn.dataset.listenerAttached === 'true') return;
      btn.dataset.listenerAttached = 'true';

      btn.addEventListener('click', async () => {
        const codeEl = btn.closest('.code-block')?.querySelector('code');
        if (!codeEl) return;

        try {
          await navigator.clipboard.writeText(codeEl.innerText);
          const originalText = btn.innerHTML;
          btn.classList.add('is-copied');
          btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>${locale === 'en' ? 'Copied' : 'Copiado'}</span>
          `;
          setTimeout(() => {
            btn.classList.remove('is-copied');
            btn.innerHTML = originalText;
          }, 1500);
        } catch (err) {
          console.error('Error copying code:', err);
        }
      });
    });
  }

  // Parser robusto y ligero de Markdown, Código y LaTeX para renderizado en cliente
  function renderMarkdown(raw: string): string {
    if (!raw) return '';

    let html = raw;

    // 1. Proteger y convertir bloques de código ```language ... ```
    const codeBlocks: string[] = [];
    html = html.replace(/```([a-zA-Z0-9_\-#+]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const cleanLang = (lang || 'code').toLowerCase();
      const escapedCode = escapeHtml(code.trimEnd());
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;

      const blockHtml = `
        <div class="code-block" data-lang="${cleanLang}">
          <div class="code-block__header">
            <span class="code-block__lang">${cleanLang}</span>
            <button type="button" class="code-copy-btn" aria-label="${
              locale === 'en' ? 'Copy code' : 'Copiar código'
            }">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
              <span>${locale === 'en' ? 'Copy' : 'Copiar'}</span>
            </button>
          </div>
          <pre class="code-block__pre"><code class="language-${cleanLang}">${escapedCode}</code></pre>
        </div>
      `;
      codeBlocks.push(blockHtml);
      return placeholder;
    });

    // 2. Fórmulas LaTeX en bloque $$ ... $$
    const mathBlocks: string[] = [];
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_match, eq) => {
      const placeholder = `__MATH_BLOCK_${mathBlocks.length}__`;
      const cleanEq = eq.trim();
      let mathHtml = '';
      const win = typeof window !== 'undefined' ? (window as any) : null;
      if (win?.katex?.renderToString) {
        try {
          mathHtml = win.katex.renderToString(cleanEq, { displayMode: true, throwOnError: false });
        } catch {
          mathHtml = `<span class="math-fallback">${escapeHtml(cleanEq)}</span>`;
        }
      } else {
        mathHtml = `<span class="math-fallback">${escapeHtml(cleanEq)}</span>`;
      }
      mathBlocks.push(
        `<div class="math-block" tabindex="0">${mathHtml}</div>`
      );
      return placeholder;
    });

    // 3. Fórmulas LaTeX inline $ ... $
    html = html.replace(/\$([^\$\n]+?)\$/g, (_match, inlineEq) => {
      const cleanInline = inlineEq.trim();
      const win = typeof window !== 'undefined' ? (window as any) : null;
      if (win?.katex?.renderToString) {
        try {
          return win.katex.renderToString(cleanInline, { displayMode: false, throwOnError: false });
        } catch {
          return `<code class="math-inline">${escapeHtml(cleanInline)}</code>`;
        }
      }
      return `<code class="math-inline">${escapeHtml(cleanInline)}</code>`;
    });

    // 4. Código inline `code`
    html = html.replace(/`([^`\n]+?)`/g, (_match, inlineCode) => {
      return `<code>${escapeHtml(inlineCode)}</code>`;
    });

    // 5. Encabezados (h3, h4)
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h3>$1</h3>');

    // 6. Negrita y cursiva
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 7. Listas con viñetas (- ...) y listas numeradas (1. ...)
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');
    // Limpieza de ul anidados contiguos
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // 8. Párrafos
    const paragraphs = html
      .split(/\n\n+/)
      .map((p) => {
        p = p.trim();
        if (!p) return '';
        if (
          p.startsWith('<div class="code-block"') ||
          p.startsWith('__CODE_BLOCK_') ||
          p.startsWith('__MATH_BLOCK_') ||
          p.startsWith('<h3>') ||
          p.startsWith('<ul>')
        ) {
          return p;
        }
        return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
      })
      .join('');

    // 9. Restaurar bloques protegidos
    let finalHtml = paragraphs;
    codeBlocks.forEach((block, idx) => {
      finalHtml = finalHtml.replace(`__CODE_BLOCK_${idx}__`, block);
    });
    mathBlocks.forEach((block, idx) => {
      finalHtml = finalHtml.replace(`__MATH_BLOCK_${idx}__`, block);
    });

    return finalHtml;
  }

  function escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
