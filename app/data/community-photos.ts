// Approved Concept C collection. Captions describe visible activity, not inferred dates or events.
export const communityPhotos = [
  {
    id: "community", src: "/images/community-carousel/community.webp", width: 1600, height: 1000, position: "center 33%",
    en: { title: "Community gathering", caption: "Neighbors gather for a group photo with Puerto Rican flags." },
    es: { title: "Encuentro comunitario", caption: "Vecinos se reúnen para una foto grupal con banderas de Puerto Rico." },
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
    id: "dsc09902", src: "/images/community-carousel/dsc09902.webp", width: 1066, height: 1600, position: "center",
    en: { title: "Joining the tug-of-war", caption: "Morales joins residents and uniformed officers for a tug-of-war on the field." },
    es: { title: "Participando en el juego de la cuerda", caption: "Morales se une a residentes y agentes uniformados para un juego de la cuerda en el campo." },
  },
  {
    id: "dsc09911", src: "/images/community-carousel/dsc09911.webp", width: 1066, height: 1600, position: "center",
    en: { title: "Tug-of-war teamwork", caption: "Morales laughs as she and fellow participants pull together on the rope." },
    es: { title: "Trabajo en equipo con la cuerda", caption: "Morales ríe mientras ella y los demás participantes tiran juntos de la cuerda." },
  },
  {
    id: "dsc09944", src: "/images/community-carousel/dsc09944.webp", width: 1066, height: 1600, position: "center",
    en: { title: "A moment to celebrate", caption: "Morales raises her arm in celebration beside the tug-of-war participants." },
    es: { title: "Un momento para celebrar", caption: "Morales levanta el brazo en señal de celebración junto a los participantes del juego de la cuerda." },
  },
  {
    id: "dsc00096", src: "/images/community-carousel/dsc00096.webp", width: 1066, height: 1600, position: "center",
    en: { title: "Conversations on the field", caption: "Morales chats with two attendees beside her office’s information table." },
    es: { title: "Conversaciones en el campo", caption: "Morales conversa con dos asistentes junto a la mesa informativa de su oficina." },
  },
  {
    id: "dsc00098", src: "/images/community-carousel/dsc00098.webp", width: 1066, height: 1600, position: "center",
    en: { title: "A warm community welcome", caption: "Morales holds a baby while posing with community members for a photo." },
    es: { title: "Una cálida bienvenida comunitaria", caption: "Morales sostiene a un bebé mientras posa con miembros de la comunidad para una foto." },
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
