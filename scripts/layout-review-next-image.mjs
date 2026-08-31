import React from "react";

export default function Image(props) {
  const {
    blurDataURL,
    fill,
    loader,
    placeholder,
    priority,
    quality,
    unoptimized,
    ...imageProps
  } = props;
  const src = typeof imageProps.src === "object" ? imageProps.src.src : imageProps.src;
  return React.createElement("img", { ...imageProps, src });
}
