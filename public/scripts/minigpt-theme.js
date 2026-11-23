(function () {
        const saved = localStorage.getItem('minigpt_theme');
        if (saved === 'dark' || saved === 'light') {
          document.documentElement.setAttribute('data-theme', saved);
          return;
        }
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
        function updateTheme(mq) {
          const theme = mq.matches ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', theme);
        }
        updateTheme(prefersDark);
        try {
          prefersDark.addEventListener('change', updateTheme);
        } catch (e) {
          prefersDark.addListener(updateTheme);
        }
      })();
