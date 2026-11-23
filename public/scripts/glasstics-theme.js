(function () {
        const saved = localStorage.getItem('glasstics_theme');
        if (saved === 'dark' || saved === 'light') {
          document.documentElement.setAttribute('data-theme', saved);
          if (saved === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
          return;
        }
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
      })();
