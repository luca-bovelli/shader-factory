export const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const blurFragmentShaderSource = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_direction;
uniform float u_radius;

float gaussianWeight(float distance, float sigma) {
  return exp(-0.5 * distance * distance / (sigma * sigma));
}

void main() {
  if (u_radius <= 0.0) {
    gl_FragColor = texture2D(u_image, v_uv);
    return;
  }
  float sigma = max(u_radius * 0.5, 0.001);
  vec4 color = texture2D(u_image, v_uv);
  float totalWeight = 1.0;
  for (int pairIndex = 0; pairIndex < 15; pairIndex++) {
    float firstDistance = float(pairIndex * 2 + 1);
    float secondDistance = firstDistance + 1.0;
    float firstWeight = gaussianWeight(firstDistance, sigma) * step(firstDistance, u_radius);
    float secondWeight = gaussianWeight(secondDistance, sigma) * step(secondDistance, u_radius);
    float pairWeight = firstWeight + secondWeight;
    if (pairWeight > 0.000001) {
      float sampleDistance = (firstDistance * firstWeight + secondDistance * secondWeight) / pairWeight;
      vec2 offset = sampleDistance * u_direction / u_resolution;
      color += texture2D(u_image, v_uv + offset) * pairWeight;
      color += texture2D(u_image, v_uv - offset) * pairWeight;
      totalWeight += 2.0 * pairWeight;
    }
  }
  gl_FragColor = color / totalWeight;
}`;

export const copyFragmentShaderSource = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
void main() { gl_FragColor = texture2D(u_image, v_uv); }
`;
