(function () {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
        function updateTheme(mediaQuery) {
          const theme = mediaQuery.matches ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', theme);
        }
        updateTheme(prefersDark);
        try {
          prefersDark.addEventListener('change', updateTheme);
        } catch (e) {
          prefersDark.addListener(updateTheme);
        }
      })();
