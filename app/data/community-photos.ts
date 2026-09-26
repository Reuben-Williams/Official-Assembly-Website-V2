// Approved Concept C collection. Captions describe visible activity, not inferred dates or events.
export const communityPhotos = [
  {
    id: "parade-group", src: "/images/community-editorial/parade-group-desktop.webp", width: 1600, height: 1066, position: "center 33%",
    mobileFraming: "caption-safe",
    en: { title: "Together along the parade route", caption: "Morales joins a group photo on a street, with parade floats behind them." },
    es: { title: "Juntos durante el desfile", caption: "Morales participa en una foto grupal en una calle, con carrozas del desfile al fondo." },
  },
  {
    id: "dsc09235", src: "/images/community-carousel/dsc09235.webp", width: 1600, height: 1066, position: "center 33%",
    en: { title: "Together at the stadium", caption: "Assemblywoman Morales joins community members for a group photo on the field." },
    es: { title: "Juntos en el estadio", caption: "La asambleísta Morales se une a miembros de la comunidad para una foto grupal en el campo." },
  },
  {
    id: "dsc09857", src: "/images/community-carousel/dsc09857.webp", width: 1600, height: 1066, position: "center 20%",
    en: { title: "Backpacks and big smiles", caption: "Morales holds up colorful backpacks at an outdoor community gathering." },
    es: { title: "Mochilas y grandes sonrisas", caption: "Morales muestra mochilas de colores en un encuentro comunitario al aire libre." },
  },
  {
    id: "bill-signing-group", src: "/images/community-editorial/bill-signing-group-desktop.webp", width: 1200, height: 1600, position: "center",
    en: { title: "Gathering in the gymnasium", caption: "Morales poses with a group in a gymnasium, with attendees gathered behind them." },
    es: { title: "Encuentro en el gimnasio", caption: "Morales posa con un grupo en un gimnasio, con asistentes reunidos detrás." },
  },
  {
    id: "community-greeting", src: "/images/community-editorial/community-greeting-desktop.webp", width: 1200, height: 1600, position: "center",
    en: { title: "A warm community greeting", caption: "Morales shares an outdoor embrace with a young child, with bicycles in the background." },
    es: { title: "Un cálido saludo comunitario", caption: "Morales comparte un abrazo al aire libre con un menor, con bicicletas al fondo." },
  },
  {
    id: "state-house-recognition", src: "/images/community-editorial/state-house-recognition-desktop.webp", width: 1066, height: 1600, position: "center",
    en: { title: "A photograph in the chamber", caption: "Morales joins a group holding a certificate in the legislative chamber." },
    es: { title: "Una foto en el recinto legislativo", caption: "Morales se une a un grupo que sostiene un certificado en el recinto legislativo." },
  },
  {
    id: "parade-walk", src: "/images/community-editorial/parade-walk-desktop.webp", width: 1600, height: 1066, position: "center 33%",
    mobileFraming: "caption-safe",
    en: { title: "Walking together at the parade", caption: "Morales walks beside a man holding an umbrella, with parade participants behind them." },
    es: { title: "Caminando juntos en el desfile", caption: "Morales camina junto a un hombre que sostiene un paraguas, con participantes del desfile detrás." },
  },
  {
    id: "chamber-group", src: "/images/community-editorial/chamber-group-desktop.webp", width: 1200, height: 1600, position: "center",
    en: { title: "Together in the legislative chamber", caption: "Morales poses with two men in suits in the legislative chamber." },
    es: { title: "Juntos en el recinto legislativo", caption: "Morales posa con dos hombres de traje en el recinto legislativo." },
  },
] as const;

export const carouselCopy = {
  en: {
    label: "Community photographs", carousel: "carousel", slide: "slide", of: "of", previous: "Previous photo", next: "Next photo",
    play: "Play", pause: "Pause", playLabel: "Play photo carousel", pauseLabel: "Pause photo carousel",
    gallery: "View all photos", galleryTitle: "Community gallery", close: "Close photo gallery", show: "Show photo",
    description: "8 photographs · Choose an image to display in the hero.",
    still: "Choosing a photograph keeps it still until you press Play.", progress: "Photo order and playback progress",
    reduced: "Reduced motion is enabled. Use the arrows or gallery.", error: "This photograph could not be loaded. Please choose another image.",
  },
  es: {
    label: "Fotografías de la comunidad", carousel: "carrusel", slide: "diapositiva", of: "de", previous: "Foto anterior", next: "Foto siguiente",
    play: "Iniciar", pause: "Pausar", playLabel: "Iniciar carrusel de fotos", pauseLabel: "Pausar carrusel de fotos",
    gallery: "Ver todas las fotos", galleryTitle: "Galería comunitaria", close: "Cerrar galería de fotos", show: "Mostrar foto",
    description: "8 fotografías · Elija una imagen para mostrar en la sección principal.",
    still: "Al elegir una fotografía, permanece fija hasta que pulse Iniciar.", progress: "Orden de fotos y progreso de reproducción",
    reduced: "El movimiento reducido está activado. Use las flechas o la galería.", error: "No se pudo cargar esta fotografía. Elija otra imagen.",
  },
} as const;
