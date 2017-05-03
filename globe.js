/*
 * This file includes code from:
 *
 * dat.globe Javascript WebGL Globe Toolkit
 * https://github.com/dataarts/webgl-globe
 *
 * Copyright 2011 Data Arts Team, Google Creative Lab
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Modifications are copyright Kiln Enterprises Ltd, 2016.
 */

var Globe = function(container) {
  var Shaders = {
    "earth" : {
      uniforms: {
        "texture": { type: "t", value: null }
      },
      vertexShader: [
        "varying vec3 vNormal;",
        "varying vec2 vUv;",
        "void main() {",
          "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
          "vNormal = normalize( normalMatrix * normal );",
          "vUv = uv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D texture;",
        "varying vec3 vNormal;",
        "varying vec2 vUv;",
        "void main() {",
          "vec3 diffuse = texture2D( texture, vUv ).xyz;",
          "float intensity = 1.05 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) );",
          "vec3 atmosphere = vec3( 1.0, 1.0, 1.0 ) * pow( intensity, 3.0 );",
          "gl_FragColor = vec4( diffuse + atmosphere, 1.0 );",
        "}"
      ].join("\n"),
      transparent: false
    },
    "arrows": {
      uniforms: {
        "uColor": { type: "3f" }
      },
      vertexShader: [
        "varying vec3 vNormal;",
        "void main() {",
          "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
          "vNormal = normalize( normalMatrix * normal );",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uColor;",
        "varying vec3 vNormal;",
        "void main() {",
          "vec3 diffuse = uColor;",
          "float intensity = 1.05 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) );",
          "vec3 atmosphere = vec3( 0.5, 0.5, 1.0 ) * pow( intensity, 3.0 );",
          "gl_FragColor = vec4( diffuse + atmosphere, 0.7 );",
        "}"
      ].join("\n"),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    }
  };

  var camera, scene, renderer, w, h;
  var mouse_is_over_canvas;
  var mousemap_scene, mousemap_texture;
  var arrows = window._arrows = {},
      arrow_by_mousemap_index = window._arrow_by_mousemap_index = {},
      next_unused_mousemap_index = 1;

  var redraw = false;

  var mouse = { x: 0, y: 0 },
      mouse_on_down = { x: 0, y: 0 },
      second_finger_on_down = { x: 0, y: 0 },
      separation_on_second_finger_down,
      angle_on_second_finger_down,
      distance_on_second_finger_down,
      touch_started = false;

  var dragging = false;

  var rotation = { x: 0, y: 0 },
      rotation_target = { x: Math.PI*3/2, y: Math.PI / 6 },
      rotation_target_on_down = { x: 0, y: 0 };

  var distance = 100000, distance_target = 1000;
  var PI_HALF = Math.PI / 2;

  var run_when_texture_loaded = [],
      texture_has_loaded = false;

  var arrow_scale = 1,
      arrow_color = [1.0, 1.0, 1.0],
      arrow_highlight_color = [1.0, 1.0, 0.1],
      texture_url = undefined;

  var sphere_geometry = new THREE.SphereGeometry(200, 60, 60);
  var texture_loader = new THREE.TextureLoader();
  var globe_mesh;

  var state_change_handlers = [];

  function init() {
    container.style.color = "#fff";
    container.style.font = "13px/20px Arial, sans-serif";

    w = container.offsetWidth || window.innerWidth;
    h = container.offsetHeight || window.innerHeight;

    camera = new THREE.PerspectiveCamera(30, w / h, 1, 10000);
    camera.position.z = distance;

    scene = new THREE.Scene();
    mousemap_scene = new THREE.Scene();
    mousemap_texture = new THREE.WebGLRenderTarget(w, h);

    if (texture_url) addGlobe(texture_url);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);

    renderer.domElement.style.position = "absolute";
    container.appendChild(renderer.domElement);

    container.addEventListener("mousedown", onMouseDown, false);
    container.addEventListener("touchstart", onTouchStart, false);
    container.addEventListener("mousewheel", onMouseWheel, false);
    document.addEventListener("keydown", onDocumentKeyDown, false);
    window.addEventListener("resize", onWindowResize, false);

    container.addEventListener("mouseover", function() { mouse_is_over_canvas = true; }, false);
    container.addEventListener("mouseout", function() { mouse_is_over_canvas = false; }, false);
  }

  function addGlobe(texture_url) {
    texture_loader.crossOrigin = '';
    texture_loader.load(texture_url, function(texture) {
      Shaders.earth.uniforms.texture.value = texture;
      globe_mesh = new THREE.Mesh(
        sphere_geometry,
        new THREE.ShaderMaterial(Shaders.earth)
      );
      globe_mesh.name = "globe";
      globe_mesh.rotation.y = Math.PI;
      scene.add(globe_mesh);

      texture_has_loaded = true;
      for (var i = 0; i < run_when_texture_loaded.length; i++) {
        run_when_texture_loaded[i]();
      }
      run_when_texture_loaded = [];
    });
  }

  function whenTextureLoaded(callback) {
    if (texture_has_loaded) callback();
    else run_when_texture_loaded.push(callback);
  }

  function setTextureUrl(new_texture_url) {
    if (new_texture_url == texture_url) return;

    if (globe_mesh) scene.remove(globe_mesh);
    addGlobe(texture_url = new_texture_url);
    redraw = true;
  }

  function setArrowScale(new_arrow_scale) {
    if (new_arrow_scale == arrow_scale) return;

    arrow_scale = new_arrow_scale;
    recomputeArrowGeometry(scene);
    recomputeArrowGeometry(mousemap_scene);
    redraw = true;
  }

  function setArrowColor(new_arrow_color) {
    if (new_arrow_color == arrow_color) return;

    arrow_color = new_arrow_color;
    recomputeArrowColors();
    redraw = true;
  }

  function setArrowHighlightColor(new_arrow_highlight_color) {
    if (new_arrow_highlight_color == arrow_highlight_color) return;

    arrow_highlight_color = new_arrow_highlight_color;
    recomputeArrowColors();
    redraw = true;
  }

  function onMouseDown(event) {
    event.preventDefault();

    dragging = true;

    container.addEventListener("mousemove", onMouseMove, false);
    container.addEventListener("mouseup", onMouseUp, false);
    container.addEventListener("mouseout", onMouseOut, false);

    mouse_on_down.x = -event.clientX;
    mouse_on_down.y = event.clientY;

    rotation_target_on_down.x = rotation_target.x;
    rotation_target_on_down.y = rotation_target.y;

    container.style.cursor = "move";
  }

  function onMouseMove(event) {
    mouse.x = - event.clientX;
    mouse.y = event.clientY;

    var zoom_damp = distance/1000;

    setRotationTarget(
      rotation_target_on_down.x + (mouse.x - mouse_on_down.x) * 0.005 * zoom_damp,
      rotation_target_on_down.y + (mouse.y - mouse_on_down.y) * 0.005 * zoom_damp
    );
  }

  function onMouseUp(event) {
    dragging = false;
    container.removeEventListener("mousemove", onMouseMove, false);
    container.removeEventListener("mouseup", onMouseUp, false);
    container.removeEventListener("mouseout", onMouseOut, false);
    container.style.cursor = "auto";
  }

  function onTouchStart(event) {
    event.preventDefault();

    if (!touch_started) {
      container.addEventListener("touchmove", onTouchMove, false);
      container.addEventListener("touchend", onTouchEnd, false);

      rotation_target_on_down.x = rotation_target.x;
      rotation_target_on_down.y = rotation_target.y;
      touch_started = true;
    }

    if (event.touches.length == 1) {
      mouse_on_down.x = -event.touches[0].clientX;
      mouse_on_down.y = event.touches[0].clientY;
    }
    else {
      var dx = event.touches[0].clientX - event.touches[1].clientX,
          dy = event.touches[0].clientY - event.touches[1].clientY;

      separation_on_second_finger_down = Math.sqrt(dx*dx + dy*dy);
      angle_on_second_finger_down = Math.atan2(dy, dx);
      distance_on_second_finger_down = distance;

      second_finger_on_down.x = -event.touches[1].clientX;
      second_finger_on_down.y = event.touches[1].clientY;

      mouse_on_down.x = -(event.touches[0].clientX + event.touches[1].clientX) / 2;
      mouse_on_down.y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    }
  }

  function onTouchMove(event) {
    // TODO: Improve multitouch behaviour
    var zoom_damp = (distance - 200)/800;

    if (event.touches.length > 1) {
      var dx = event.touches[0].clientX - event.touches[1].clientX,
          dy = event.touches[0].clientY - event.touches[1].clientY;

      var separation = Math.sqrt(dx*dx + dy*dy);
      var angle = Math.atan2(dy, dx);

      mouse.x = -(event.touches[0].clientX + event.touches[1].clientX)/2;
      mouse.y = (event.touches[0].clientY + event.touches[1].clientY)/2;

      setDistanceTarget(distance / (separation / separation_on_second_finger_down));
      setRotationTarget(
        rotation_target_on_down.x + Math.sin(angle - angle_on_second_finger_down) + (mouse.x - mouse_on_down.x) * 0.005 * zoom_damp,
        rotation_target_on_down.y + (mouse.y - mouse_on_down.y) * 0.005 * zoom_damp
       );
    }
    else {
      mouse.x = -event.touches[0].clientX;
      mouse.y = event.touches[0].clientY;

      setRotationTarget(
        rotation_target_on_down.x + (mouse.x - mouse_on_down.x) * 0.005 * zoom_damp,
        rotation_target_on_down.y + (mouse.y - mouse_on_down.y) * 0.005 * zoom_damp
      );
    }
  }

  function onTouchEnd(event) {
    if (event.touches.length == 0) {
      touch_started = false;
      container.removeEventListener("touchmove", onTouchMove, false);
      container.removeEventListener("touchend", onTouchEnd, false);
    }
    else if (event.touches.length == 1) {
      mouse_on_down.x = -event.touches[0].clientX;
      mouse_on_down.y = event.touches[0].clientY;

      rotation_target_on_down.x = rotation_target.x;
      rotation_target_on_down.y = rotation_target.y;
    }
  }

  function onMouseOut(event) {
    dragging = false;
    container.removeEventListener("mousemove", onMouseMove, false);
    container.removeEventListener("mouseup", onMouseUp, false);
    container.removeEventListener("mouseout", onMouseOut, false);
  }

  function onMouseWheel(event) {
    event.preventDefault();
    if (mouse_is_over_canvas) {
      zoom(event.wheelDeltaY * 0.3);
    }
    return false;
  }

  function onDocumentKeyDown(event) {
    switch (event.keyCode) {
      case 38:
        zoom(100);
        event.preventDefault();
        break;
      case 40:
        zoom(-100);
        event.preventDefault();
        break;
    }
  }

  function onWindowResize(event) {
    w = container.offsetWidth || window.innerWidth;
    h = container.offsetHeight || window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize( w, h );
    redraw = true;

    mousemap_texture = new THREE.WebGLRenderTarget(w, h);
  }

  function zoom(delta) {
    setDistanceTarget(distance_target - delta);
  }

  function begin() {
    whenTextureLoaded(function() {
      renderer.domElement.style.display = "block";
      requestAnimationFrame(animate);
    });
  }

  function animate(timestamp) {
    render(timestamp);
    requestAnimationFrame(animate);
  }

  var animation_functions = {},
      num_animation_functions = 0;
  function startAnimation(name, duration, delay, action, onEnd) {
    var first_timestamp = null;
    animation_functions[name] = function(timestamp) {
      if (first_timestamp == null) first_timestamp = timestamp;
      var dt = timestamp - first_timestamp;
      if (dt < delay) return;
      dt -= delay;

      var p = duration == 0 ? 1 : Math.min(1, dt/duration);
      action(ease(p));

      var finished = (dt >= duration);
      if (finished && onEnd) onEnd();
      return finished;
    };
    num_animation_functions += 1;
  }

  function runAnimationFunctions(timestamp) {
    for (var k in animation_functions) {
      var f = animation_functions[k];
      if (f(timestamp)) {
        delete animation_functions[k];
        num_animation_functions -= 1;
      }
    }
  }

  function angularDistance(r0, r1) {
    return Math.acos(r0.x*r1.x + r0.y*r1.y + r0.z*r1.z);
  }

  // Linear interpolation on the surface of the unit sphere.
  // Input points are assumed to be on the unit sphere.
  function slerpXyz(r0, r1, t) {
    // Omega is the angular distance between r0 and r1
    var omega = angularDistance(r0, r1),
        sin_omega = Math.sin(omega);

    // http://en.wikipedia.org/wiki/Slerp
    var alpha = Math.sin((1-t)*omega)/sin_omega,
        beta = Math.sin(t*omega)/sin_omega;

    return {
        x: alpha*r0.x + beta*r1.x,
        y: alpha*r0.y + beta*r1.y,
        z: alpha*r0.z + beta*r1.z,
        omega: omega
    };
  }

  // The tangent vector at r0 in the direction of r1
  function tangentVector(r0, r1) {
    // Omega is the angular distance between r0 and r1
    var omega = angularDistance(r0, r1),
        sin_omega = Math.sin(omega);

    // Differentiate slerpXyz(r0, r1, t) with respect to t
    var alpha = -omega * Math.cos(omega) / sin_omega,
        beta = omega / sin_omega;

    var tv = new THREE.Vector3(
        alpha*r0.x + beta*r1.x,
        alpha*r0.y + beta*r1.y,
        alpha*r0.z + beta*r1.z
    );
    tv.normalize();

    return tv;
  }

  function perpendicularTangentVector(r0, r1) {
    var tv = tangentVector(r0, r1);
    var straight = new THREE.Vector3(r1.x, r1.y, r1.z);
    straight.sub(new THREE.Vector3(r0.x, r0.y, r0.z));

    tv.cross(straight);
    tv.normalize();
    return tv;
  }

  // Convert lon/lat to rectangular coordinates on the unit sphere
  function longLatToXyz(lambda, phi) {
    return {
        x: Math.cos(lambda) * Math.cos(phi),
        y: Math.sin(lambda) * Math.cos(phi),
        z: Math.sin(phi)
    };
  }

  // Convert positions on the unit sphere to long/lat
  function xyzToLongLat(xyz) {
    var int_lat = Math.asin(xyz.z),
        d = Math.acos(xyz.z),
        int_lon = d == 0 ? 0 : Math.atan2(xyz.y/d, xyz.x/d);

    return [ int_lon, int_lat ];
  }

  // Convert from the mathematician’s coordinate frame
  // to the one used by WebGL.
  var math_coords_to_webgl = new THREE.Matrix3();
  math_coords_to_webgl.set(-1,0,0, 0,0,1, 0,1,0);

  function ease(t) {
    if (t <= 0.5) return 4 * t*t*t;
    return 1 - 4 * (1-t)*(1-t)*(1-t);
  }

  function computeVectors(src, dst) {
    var deg_to_rad = Math.PI / 180;
    var lambda_0 = src[0] * deg_to_rad,
        phi_0 = src[1] * deg_to_rad,
        lambda_1 = dst[0] * deg_to_rad,
        phi_1 = dst[1] * deg_to_rad;

    var r0 = longLatToXyz(lambda_0, phi_0),
        r1 = longLatToXyz(lambda_1, phi_1);

    return {
      r0: r0, r1: r1, tangent_vector: perpendicularTangentVector(r0, r1)
    };
  }

  function arrowGeometry(src, dst, name, is_mousemap) {
    var vectors = computeVectors(src, dst);
    return new THREE.ParametricGeometry(function(raw_u, v) {
      var a = is_mousemap ? 1 : arrows[name].animation_position;
      var u = raw_u * a;
      var score = is_mousemap ? arrows[name].score : arrows[name].animation_score;
      if (is_mousemap) {
        var min_score = distance_target / 500;
        if (0 < score && score < min_score) score = min_score;
      }

      var r = slerpXyz(vectors.r0, vectors.r1, u);

      var p = new THREE.Vector3(r.x, r.y, r.z);
      p.multiplyScalar(200 + 30 * 4 * u * (1-u));

      var t = new THREE.Vector3();
      t.copy(vectors.tangent_vector);
      t.multiplyScalar(score * arrow_scale * (v - 0.5) * 2 * (4 * u * (1-u)));
      p.add(t);

      p.applyMatrix3(math_coords_to_webgl);
      p.u = raw_u;
      p.v = v;
      return p;
    }, 100, 5);
  }

  function arrowMaterial(arrow_color) {
    Shaders.arrows.uniforms.uColor.value = arrow_color;
    var material = new THREE.ShaderMaterial(Shaders.arrows);
    material.uniforms = THREE.UniformsUtils.clone(material.uniforms);
    return material;
  }

  function mousemapArrowMaterial(index) {
    return new THREE.MeshBasicMaterial({ vertexColors: THREE.VertexColors });
  }

  function addArrow(src, dst, name) {
    var mesh = new THREE.Mesh(
      arrowGeometry(src, dst, name),
      arrowMaterial(arrow_color)
    );
    if (name) mesh.name = name;

    scene.add(mesh);
    redraw = true;

    return mesh;
  }

  function addMousemapArrow(src, dst, name, index) {
    var geometry = arrowGeometry(src, dst, name, true),
        color = new THREE.Color(index);
    geometry.faces.forEach(function(face) {
      var num_vertices = (face instanceof THREE.Face3) ? 3 : 4;
      for (var i = 0; i < num_vertices; i++) {
        face.vertexColors[i] = color;
      }
    });
    var mesh = new THREE.Mesh(geometry, mousemapArrowMaterial(index));
    if (name) mesh.name = name;

    mousemap_scene.add(mesh);
    return mesh;
  }

  var highlighted_arrow_name = undefined;

  function highlightArrow(name) {
    highlighted_arrow_name = name;
    recomputeArrowColors();
    redraw = true;
  }

  function recomputeArrowColors() {
    for (var i = 0; i < scene.children.length; i++) {
      var c = scene.children[i];
      if (!c.material.uniforms.uColor) continue;
      c.material.uniforms.uColor.value = (
        (c.name == highlighted_arrow_name) ? arrow_highlight_color : arrow_color
      );
    }
  }

  var arrows_being_removed = {},
      arrows_being_created = {};
  function updateArrows(replacement_arrows) {
    var removed_arrows = {},
        updated_arrows = {},
        new_arrows = {};
    for (var name in arrows) removed_arrows[name] = true;

    for (name in replacement_arrows) {
      (name in arrows ? updated_arrows : new_arrows)[name] = replacement_arrows[name];
      delete removed_arrows[name];
    }

    for (name in new_arrows) {
      arrows[name] = new_arrows[name];
      arrows[name].animation_position = 0;
      arrows[name].mousemap_index = next_unused_mousemap_index++;
      arrow_by_mousemap_index[arrows[name].mousemap_index] = arrows[name];
    }
    for (name in updated_arrows) {
      var animation_position = arrows[name].animation_position,
          animation_score = arrows[name].animation_score,
          mesh = arrows[name].mesh,
          mousemap_mesh = arrows[name].mousemap_mesh;

      arrows[name] = updated_arrows[name];

      arrows[name].animation_position = animation_position;
      arrows[name].animation_score = animation_score;
      arrows[name].mesh = mesh;
      arrows[name].mousemap_mesh = mousemap_mesh;
    }

    var i = 0;
    for (name in new_arrows) {
      (function(arrow, name) {
        arrow.mesh = addArrow(arrow.src, arrow.dst, name);
        arrow.mousemap_mesh = addMousemapArrow(arrow.src, arrow.dst, name, arrow.mousemap_index);
        arrow.animation_score = arrow.score;

        startAnimation(name, 2000, 40 * i, function(t) {
          arrows[name].animation_position = t;
        }, function() {
          delete arrows_being_created[name];
        });
      })(arrows[name], name);
      arrows_being_created[name] = true;
      i += 1;
    }

    for (name in updated_arrows) {
      if (name in arrows_being_removed) {
        (function (start_pos, start_score, name) {
          startAnimation(name, 2000 * (1 - start_pos), 40 * i, function(t) {
            arrows[name].animation_position = start_pos + t * (1 - start_pos);
            arrows[name].animation_score = start_score + t * (arrows[name].score - start_score);
          }, function() {
            delete arrows_being_created[name];
          });
        })(arrows[name].animation_position || 0, arrows[name].animation_score, name);
        delete arrows_being_removed[name];
        arrows_being_created[name] = true;
        i += 1;
      }
      else if (!(name in arrows_being_created)) {
        (function (start_score, name) {
          startAnimation(name, 2000, 0, function(t) {
            arrows[name].animation_score = start_score + t * (arrows[name].score - start_score);
          });
        })(arrows[name].animation_score, name);
      }
    }

    i = 0;
    for (name in removed_arrows) {
      if (arrows_being_removed[name]) continue;
      arrows_being_removed[name] = true;
      delete arrows_being_created[name];

      (function(start_pos, arrow, name) {
        startAnimation(name, 2000 * start_pos, 0, function(t) {
          arrows[name].animation_position = start_pos - t * start_pos;
        },
        function() {
          scene.remove(arrows[name].mesh);
          mousemap_scene.remove(arrows[name].mousemap_mesh);
          delete arrow_by_mousemap_index[arrows[name].mousemap_index];
          delete arrows[name];
          delete arrows_being_removed[name];
        });
      })(arrows[name].animation_position || 1, arrows[name], name);
      i += 1;
    }

    recomputeArrowGeometry(mousemap_scene);
  }

  function recomputeVertices(geometry) {
    var vertex_index = 0;
    for (var stack = 0; stack <= geometry.parameters.stacks; stack++) {
      for (var slice = 0; slice <= geometry.parameters.slices; slice++) {
        var u = slice / geometry.parameters.slices,
            v = stack / geometry.parameters.stacks;
        geometry.vertices[vertex_index].copy(geometry.parameters.func(u, v));
        vertex_index++;
      }
    }
    geometry.verticesNeedUpdate = true;
    geometry.normalsNeedUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeFaceNormals();
    geometry.computeBoundingSphere();
  }

  function recomputeArrowGeometry(scene) {
    var meshes = scene.children;
    for (var i = 0; i < meshes.length; i++) {
      var geometry = meshes[i].geometry;
      if (geometry.type == "ParametricGeometry") recomputeVertices(geometry);
    }
  }

  var eps = 0.01;
  function render(timestamp) {
    if (!redraw && ((
        Math.abs(rotation.x - rotation_target.x) < eps
        && Math.abs(rotation.y - rotation_target.y) < eps
        && Math.abs(distance_target - distance) < eps
      ) && num_animation_functions == 0)
    ) return;
    redraw = false;

    rotation.x += (rotation_target.x - rotation.x) * 0.1;
    rotation.y += (rotation_target.y - rotation.y) * 0.1;
    distance += (distance_target - distance) * 0.3;

    if (num_animation_functions > 0) {
      runAnimationFunctions(timestamp);
      recomputeArrowGeometry(scene);
    }

    camera.position.x = distance * Math.sin(rotation.x) * Math.cos(rotation.y);
    camera.position.y = distance * Math.sin(rotation.y);
    camera.position.z = distance * Math.cos(rotation.x) * Math.cos(rotation.y);

    camera.lookAt({x:0, y:0, z:0});
    camera.translateX(-50);
    renderer.render(scene, camera);
  }

  function arrowAtCoordinate(x, y) {
    // If we’re currently zooming or dragging, mouseovers are disabled
    if (Math.abs(distance_target - distance) >= eps) return;
	if (dragging || touch_started) return;

    renderer.render(mousemap_scene, camera, mousemap_texture);
    var pixel_buffer = new Uint8Array( 4 );
    renderer.readRenderTargetPixels(mousemap_texture, x, h - y, 1, 1, pixel_buffer);
    var mousemap_index = (pixel_buffer[0] << 16) | (pixel_buffer[1] << 8) | (pixel_buffer[2]);

    if (mousemap_index == 0) return;
    return arrow_by_mousemap_index[mousemap_index].mesh.name;
  }

  function onStateChange(handler) {
    state_change_handlers.push(handler);
  }

  function notifyStateChange(key, value) {
    for (var i = 0; i < state_change_handlers.length; i++) {
      state_change_handlers[i](key, value);
    }
  }

  function getRotationTargetGeographic() {
    return [rotation_target.x + Math.PI / 2, rotation_target.y];
  }
  function setRotationTarget(x, y) {
    rotation_target.x = x;
    rotation_target.y = y;
    rotation_target.y = rotation_target.y > PI_HALF ? PI_HALF : rotation_target.y;
    rotation_target.y = rotation_target.y < -PI_HALF ? -PI_HALF : rotation_target.y;

    // Send notifications in geographic coordinates
    notifyStateChange("rotation_x", rotation_target.x + Math.PI / 2);
    notifyStateChange("rotation_y", rotation_target.y);
  }
  function setRotationTargetGeographic(x, y) {
    setRotationTarget(x - Math.PI / 2, y);
  }

  function getDistanceTarget() {
    return distance_target;
  }
  function setDistanceTarget(distance) {
    distance_target = distance;
    distance_target = distance_target > 1000 ? 1000 : distance_target;
    distance_target = distance_target < 350 ? 350 : distance_target;
    notifyStateChange("distance", distance);
    recomputeArrowGeometry(mousemap_scene);
  }

  init();
  this.begin = begin;
  this.renderer = renderer;
  this.scene = scene;
  this.updateArrows = updateArrows;

  this.getRotation = getRotationTargetGeographic;
  this.rotateTo = setRotationTargetGeographic;

  this.getZoom = getDistanceTarget;
  this.zoomTo = setDistanceTarget;

  this.highlightArrow = highlightArrow;

  this.arrowAtCoordinate = arrowAtCoordinate;

  this.setTextureUrl = setTextureUrl;
  this.setArrowScale = setArrowScale;
  this.setArrowColor = setArrowColor;
  this.setArrowHighlightColor = setArrowHighlightColor;

  this.onStateChange = onStateChange;

  return this;
};
