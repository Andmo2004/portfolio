// src/i18n/translations.ts

export type Locale = 'es' | 'en';

export interface ProjectCollaborator {
  name: string;
  role?: string;
  url?: string;
}

export interface ProjectItem {
  title: string;
  description: string;
  tags: string[];
  href: string;
  badge?: string;
  collaborator?: ProjectCollaborator;
  image?: {
    src: string;
    alt: string;
  };
  logos?: {
    iconLight: string;
    iconDark: string;
    nameLight?: string;
    nameDark?: string;
    alt: string;
  };
  isExternal?: boolean;
}

export interface TranslationSchema {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    mark: string;
    projects: string;
    tech: string;
    about: string;
    contact: string;
    github: string;
    linkedin?: string;
    langSwitchLabel: string;
    langSwitchTarget: string;
  };
  hero: {
    name: string;
    tagline: string;
    bioBrief: string;
    ctaProjects: string;
    ctaGithub: string;
    ctaLinkedin?: string;
    asciiCaption?: string;
  };
  clock: {
    madridLabel: string;
    visitorLabel: string;
  };
  projects: {
    sectionRef: string;
    sectionTitle: string;
    exploreLabel: string;
    statusNotice: string;
    items: ProjectItem[];
  };
  tech: {
    sectionRef: string;
    sectionTitle: string;
    description: string;
    categories: Array<{
      category: string;
      items: string[];
    }>;
  };
  about: {
    sectionRef: string;
    sectionTitle: string;
    lead: string;
    paragraphs: string[];
    highlights: Array<{
      label: string;
      value: string;
    }>;
  };
  contact: {
    sectionRef: string;
    sectionTitle: string;
    lead: string;
    emailLabel: string;
    locationLabel: string;
    locationValue: string;
    linksLabel: string;
  };
  footer: {
    backToTop: string;
    rights: string;
    aesthetic: string;
  };
}

export const translations: Record<Locale, TranslationSchema> = {
  es: {
    meta: {
      title: 'Andrés Moros — Software · AI · Data · Systems · Cloud',
      description: 'Portfolio de Andrés Moros. Ingeniero de software especializado en IA, machine learning, sistemas distribuidos y desarrollo de software.',
    },
    nav: {
      mark: 'Andrés Moros',
      projects: 'Proyectos',
      tech: 'Stack',
      about: 'Sobre mí',
      contact: 'Contacto',
      github: 'GitHub',
      linkedin: 'LinkedIn',
      langSwitchLabel: 'EN',
      langSwitchTarget: '/en',
    },
    hero: {
      name: 'Andrés Moros',
      tagline: 'Software · AI · Data · Systems · Cloud',
      bioBrief: 'Graduado en Ingeniería Informática (Especialidad en Computación) por la Universidad de Córdoba y estudiante del Máster en Inteligencia Artificial (UNIR). Desarrollo de software con C#/.NET, Python, PyTorch, C/C++ e investigación aplicada.',
      ctaProjects: 'Ver proyectos',
      ctaGithub: 'GitHub',
      ctaLinkedin: 'LinkedIn',
      asciiCaption: 'fig. 00 > andres_moros.asc',
    },
    clock: {
      madridLabel: 'MAD',
      visitorLabel: 'LOC',
    },
    projects: {
      sectionRef: 'SEC. 01',
      sectionTitle: 'Proyectos Seleccionados',
      exploreLabel: 'Explorar',
      statusNotice: 'Casos de estudio y proyectos',
      items: [
        {
          title: 'miniGPT',
          description: 'Proyecto educativo de Transformer autorregresivo en PyTorch, con pruebas de entrenamiento en TinyStories. Sin servicio de inferencia público.',
          tags: ['Python', 'PyTorch', 'Transformers', 'NLP'],
          href: '/projects/minigpt',
          logos: {
            iconLight: '/minigpt/logo-light.svg',
            iconDark: '/minigpt/logo-dark.svg',
            alt: 'miniGPT',
          },
          isExternal: false,
        },
        {
          title: 'MIClustering',
          description: 'Librería científica de Machine Learning en Python desarrollada como trabajo de investigación en Multiple-Instance Learning (MIL). Implementación de agrupamiento basado en densidad mediante la adaptación de métricas de distancia existentes a bolsas de instancias.',
          tags: ['Python', 'Scikit-learn', 'NumPy', 'MIL', 'Research'],
          href: 'https://github.com/Andmo2004/MIClustering',
          image: {
            src: '/miclustering/icon-miclustering.svg',
            alt: 'MIClustering',
          },
          logos: {
            iconLight: '/miclustering/icon-miclustering.svg',
            iconDark: '/miclustering/icon-miclustering.svg',
            nameLight: '/miclustering/name-miclustering.svg',
            nameDark: '/miclustering/name-miclustering.svg',
            alt: 'MIClustering — Librería de Machine Learning (Multiple-Instance Learning)',
          },
          isExternal: true,
        },
        {
          title: 'Glasstics',
          description: 'Prototipo de dashboard para explorar el uso de IA en desarrollo software, creado en pareja durante un hackathon. Sin despliegue público.',
          badge: 'Reto Hackathon · Gobierno y control de IA',
          collaborator: {
            name: 'Miguel Ángel Montijano Sempere',
            role: 'Coautor (Reto en parejas)',
            // url: 'https://linkedin.com/in/...', // Listo para cuando añadas el enlace
          },
          tags: ['FastAPI', 'Python 3.12', 'React', 'PostgreSQL', 'Anthropic API', 'Prophet', 'Docker'],
          href: '/projects/glasstics',
          image: {
            src: '/glasticss/icon-for-light-theme.svg',
            alt: 'Glasstics',
          },
          logos: {
            iconLight: '/glasticss/icon-for-light-theme.svg',
            iconDark: '/glasticss/icon-for-dark-theme.svg',
            nameLight: '/glasticss/name-for-light-theme.svg',
            nameDark: '/glasticss/name-for-dark-theme.svg',
            alt: 'Glasstics — Gobierno y observabilidad de IA',
          },
          isExternal: false,
        },
      ],
    },
    tech: {
      sectionRef: 'SEC. 02',
      sectionTitle: 'Competencias Técnicas',
      description: 'Herramientas, lenguajes y entornos empleados en ingeniería de software, investigación y sistemas.',
      categories: [
        {
          category: 'Lenguajes',
          items: ['Python', 'C#', 'C/C++', 'JavaScript', 'SQL', 'Bash'],
        },
        {
          category: 'Ingeniería de Software & Web',
          items: ['.NET', 'Full Stack', 'REST APIs', 'Git/GitHub', 'Docker'],
        },
        {
          category: 'Datos & Machine Learning',
          items: ['PyTorch', 'Scikit-learn', 'Pandas', 'NumPy', 'DBSCAN / MIL'],
        },
        {
          category: 'Cloud & Sistemas',
          items: ['Linux', 'Data Engineering'],
        },
      ],
    },
    about: {
      sectionRef: 'SEC. 03',
      sectionTitle: 'Perfil Profesional',
      lead: 'Ingeniero Informático enfocado en la intersección entre ingeniería de software robusta y modelado de inteligencia artificial.',
      paragraphs: [
        'Graduado en Ingeniería Informática con especialidad en Computación por la Universidad de Córdoba y actualmente cursando el Máster Universitario en Inteligencia Artificial en UNIR.',
        'Cuento con experiencia profesional en desarrollo de aplicaciones web corporativas fullstack con C#/.NET, JavaScript y SQL (CTI Computación, Tecnología e Innovación), así como en investigación aplicada: he desarrollado una librería en Python para Multiple-Instance Learning (MIL).',
        'Ganador del primer premio en el Hackathon Tecnológico de la Cátedra Atmira OpenAI & Big Data, desarrollando prototipos funcionales bajo entornos de alta exigencia.',
      ],
      highlights: [
        { label: 'Ubicación', value: 'Córdoba, España' },
        { label: 'Formación', value: 'Grado en Ing. Informática (UCO) · Máster en IA (UNIR)' },
        { label: 'Idiomas', value: 'Español (Nativo) · Inglés (C1 British Council)' },
        { label: 'Especialidad', value: 'Software Engineering · AI/ML Systems' },
      ],
    },
    contact: {
      sectionRef: 'SEC. 04',
      sectionTitle: 'Contacto',
      lead: 'Disponible para oportunidades en Ingeniería de Software, Machine Learning y AI Engineering.',
      emailLabel: 'Correo Electrónico',
      locationLabel: 'Ubicación',
      locationValue: 'Córdoba, España',
      linksLabel: 'Redes y Perfiles',
    },
    footer: {
      backToTop: 'Volver arriba',
      rights: 'Andrés Moros. Todos los derechos reservados.',
      aesthetic: 'Preprint layout · Construido con Astro & CSS Vanilla',
    },
  },
  en: {
    meta: {
      title: 'Andrés Moros — Software · AI · Data · Systems · Cloud',
      description: 'Portfolio of Andrés Moros. Software engineer specializing in AI, machine learning, distributed systems, and core software engineering.',
    },
    nav: {
      mark: 'Andrés Moros',
      projects: 'Projects',
      tech: 'Stack',
      about: 'About',
      contact: 'Contact',
      github: 'GitHub',
      linkedin: 'LinkedIn',
      langSwitchLabel: 'ES',
      langSwitchTarget: '/',
    },
    hero: {
      name: 'Andrés Moros',
      tagline: 'Software · AI · Data · Systems · Cloud',
      bioBrief: 'Computer Engineering graduate (Computer Science Specialization) from the University of Córdoba, currently pursuing a Master\'s Degree in Artificial Intelligence (UNIR). Software development with C#/.NET, Python, PyTorch, C/C++, and applied research.',
      ctaProjects: 'View Projects',
      ctaGithub: 'GitHub',
      ctaLinkedin: 'LinkedIn',
      asciiCaption: 'fig. 00 > andres_moros.asc',
    },
    clock: {
      madridLabel: 'MAD',
      visitorLabel: 'LOC',
    },
    projects: {
      sectionRef: 'SEC. 01',
      sectionTitle: 'Selected Projects',
      exploreLabel: 'Explore',
      statusNotice: 'Selected projects and case studies',
      items: [
        {
          title: 'miniGPT',
          description: 'Educational autoregressive Transformer in PyTorch, with small-scale TinyStories training tests. No public inference service.',
          tags: ['Python', 'PyTorch', 'Transformers', 'NLP'],
          href: '/en/projects/minigpt',
          logos: {
            iconLight: '/minigpt/logo-light.svg',
            iconDark: '/minigpt/logo-dark.svg',
            alt: 'miniGPT',
          },
          isExternal: false,
        },
        {
          title: 'MIClustering',
          description: 'Python scientific Machine Learning library developed as part of research in Multiple-Instance Learning (MIL). Density-based clustering implementation adapting existing distance metrics to instance bags.',
          tags: ['Python', 'Scikit-learn', 'NumPy', 'MIL', 'Research'],
          href: 'https://github.com/Andmo2004/MIClustering',
          image: {
            src: '/miclustering/icon-miclustering.svg',
            alt: 'MIClustering',
          },
          logos: {
            iconLight: '/miclustering/icon-miclustering.svg',
            iconDark: '/miclustering/icon-miclustering.svg',
            nameLight: '/miclustering/name-miclustering.svg',
            nameDark: '/miclustering/name-miclustering.svg',
            alt: 'MIClustering — Python Machine Learning Library for Multiple-Instance Learning',
          },
          isExternal: true,
        },
        {
          title: 'Glasstics',
          description: 'Hackathon dashboard prototype for exploring AI use in software development, built by a two-person team. No public deployment.',
          badge: 'Hackathon Challenge · AI Governance & Control',
          collaborator: {
            name: 'Miguel Ángel Montijano Sempere',
            role: 'Co-developer (Team project)',
            // url: 'https://linkedin.com/in/...', // Ready for LinkedIn link
          },
          tags: ['FastAPI', 'Python 3.12', 'React', 'PostgreSQL', 'Anthropic API', 'Prophet', 'Docker'],
          href: '/en/projects/glasstics',
          image: {
            src: '/glasticss/icon-for-light-theme.svg',
            alt: 'Glasstics',
          },
          logos: {
            iconLight: '/glasticss/icon-for-light-theme.svg',
            iconDark: '/glasticss/icon-for-dark-theme.svg',
            nameLight: '/glasticss/name-for-light-theme.svg',
            nameDark: '/glasticss/name-for-dark-theme.svg',
            alt: 'Glasstics — AI Governance & Observability',
          },
          isExternal: false,
        },
      ],
    },
    tech: {
      sectionRef: 'SEC. 02',
      sectionTitle: 'Technical Stack',
      description: 'Languages, frameworks, and environments used across software engineering, applied research, and systems.',
      categories: [
        {
          category: 'Languages',
          items: ['Python', 'C#', 'C/C++', 'JavaScript', 'SQL', 'Bash'],
        },
        {
          category: 'Software Engineering & Web',
          items: ['.NET', 'Full Stack', 'REST APIs', 'Git/GitHub', 'Docker'],
        },
        {
          category: 'Data & Machine Learning',
          items: ['PyTorch', 'Scikit-learn', 'Pandas', 'NumPy', 'DBSCAN / MIL'],
        },
        {
          category: 'Cloud & Systems',
          items: ['Linux', 'Data Engineering'],
        },
      ],
    },
    about: {
      sectionRef: 'SEC. 03',
      sectionTitle: 'Professional Profile',
      lead: 'Computer Engineer focused on the intersection between robust software engineering and applied artificial intelligence.',
      paragraphs: [
        'Computer Engineering graduate with a specialization in Computer Science from the University of Córdoba, currently pursuing a Master\'s Degree in Artificial Intelligence at UNIR.',
        'Hands-on professional experience developing fullstack corporate web applications with C#/.NET, JavaScript, and SQL at CTI Computación, complemented by applied research: developed a Python library for Multiple-Instance Learning (MIL).',
        '1st Place Winner at the Atmira OpenAI & Big Data Chair Technology Hackathon, building functional prototypes under tight time constraints.',
      ],
      highlights: [
        { label: 'Location', value: 'Córdoba, Spain' },
        { label: 'Education', value: 'BSc Computer Engineering (UCO) · MSc AI (UNIR)' },
        { label: 'Languages', value: 'Spanish (Native) · English (C1 British Council)' },
        { label: 'Focus', value: 'Software Engineering · AI/ML Systems' },
      ],
    },
    contact: {
      sectionRef: 'SEC. 04',
      sectionTitle: 'Contact',
      lead: 'Seeking opportunities in Software Engineering, Machine Learning, and AI Engineering.',
      emailLabel: 'Email Address',
      locationLabel: 'Location',
      locationValue: 'Córdoba, Spain',
      linksLabel: 'Networks & Profiles',
    },
    footer: {
      backToTop: 'Back to top',
      rights: 'Andrés Moros. All rights reserved.',
      aesthetic: 'Preprint layout · Built with Astro & Vanilla CSS',
    },
  },
};
