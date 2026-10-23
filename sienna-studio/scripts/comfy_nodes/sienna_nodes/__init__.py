"""
Sienna Studio custom ComfyUI nodes (installed by scripts/comfyui-bootstrap.sh).

  SiennaPoseRetarget     POSE_KEYPOINT → OpenPose image with Sienna's proportions (angles kept)
  SiennaGarmentIsolate   photo + garment/person/face masks → garment-only crop for the outfit adapter
  SiennaChinCrop         clothing photo + face-box mask → crop below the chin (Edit Outfit reference)
  SiennaGarmentOnly      clothing photo → garment pixels on grey, model's skin/figure removed (falls back to chin crop)
  SiennaBodySheet        approved Sienna body references stitched into one image
  SiennaBodyMeasure      image + DWPose keypoints + person mask → body proportions (JSON)
  SiennaBodyCheck        source / result / reference measurements → body-consistency report (JSON)
  SiennaExposureCheck    image(s) → did a nipple show? (NudeNet; JSON per image, for the app's retry)
  SiennaFaceCheck        image(s) + reference embedding → how close the face is to Sienna (OpenCV SFace; JSON)
  SiennaSafeFrame        photo + movement margins → photo with the missing room around her added + outpaint mask (video)
  SiennaLockCamera       video frames → frames with the camera's drift removed (background held still) + JSON report (video)
  SiennaFigureMask       photo + person mask + DWPose → hip/butt region to redraw (figure pass, test only)
  SiennaFigureComposite  original + redrawn photo + region → colours matched back per class, pasted in (figure pass)

The math lives in sienna_pose.py / sienna_garment.py / sienna_crop.py / sienna_body.py / sienna_frame.py / sienna_stabilize.py
(no ComfyUI imports; unit-tested).
"""

import json

import cv2
import numpy as np
import torch

from .sienna_body import SCENE_CHANGED, body_sheet, compare, garment_only, keypoints_from_pose, measure_body, scale_points, scene_backdrop, scene_change
from .sienna_crop import chin_crop
from . import sienna_frame
from . import sienna_stabilize
from .sienna_exposure import DEFAULT_THRESHOLD, detector, detector_error, summarize
from . import sienna_face
from .sienna_redraw import GROW_MODES, erase, garment_region, overlay, segment_classes, segmenter_error
from .sienna_garment import garment_composite
from .sienna_pose import DEFAULT_PROPORTIONS, retarget_openpose
from . import sienna_figure


def _mask_np(mask, i, shape):
    if mask is None:
        return None
    m = mask[min(i, mask.shape[0] - 1)] if mask.dim() == 3 else mask
    return m.detach().cpu().numpy().astype(np.float32)


class SiennaPoseRetarget:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pose_keypoint": ("POSE_KEYPOINT",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "max_change": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 0.5, "step": 0.01}),
                "proportions": ("STRING", {"default": json.dumps(DEFAULT_PROPORTIONS), "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("pose_image", "factors")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, pose_keypoint, strength, max_change, proportions):
        try:
            target = {k: float(v) for k, v in json.loads(proportions or "{}").items()} or DEFAULT_PROPORTIONS
        except (ValueError, TypeError):
            target = DEFAULT_PROPORTIONS
        frames, dicts, factors = [], [], []
        for pose in pose_keypoint if isinstance(pose_keypoint, list) else [pose_keypoint]:
            canvas, new_pose, f = retarget_openpose(pose, target, strength, max_change)
            frames.append(torch.from_numpy(canvas.astype(np.float32) / 255.0))
            dicts.append(new_pose)
            factors.append(f)
        text = json.dumps(factors)
        return {
            "ui": {"openpose_json": [json.dumps(dicts)], "text": [text]},
            "result": (torch.stack(frames, 0), text),
        }


class SiennaGarmentIsolate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "garment_mask": ("MASK",),
                "person_mask": ("MASK",),
                "edge_px": ("INT", {"default": 6, "min": 0, "max": 64}),
                "silhouette": ("BOOLEAN", {"default": True}),
                "margin": ("FLOAT", {"default": 0.12, "min": 0.0, "max": 1.0, "step": 0.01}),
            },
            "optional": {"face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "mode")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, garment_mask, person_mask, edge_px, silhouette, margin, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        out, mode = garment_composite(
            img,
            _mask_np(garment_mask, 0, shape),
            _mask_np(person_mask, 0, shape),
            _mask_np(face_mask, 0, shape),
            edge_px=edge_px,
            silhouette=silhouette,
            margin=margin,
        )
        return {"ui": {"text": [mode]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], mode)}


class SiennaChinCrop:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "margin": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.01}),
                "min_keep": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
            },
            "optional": {"face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, margin, min_keep, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        out, info = chin_crop(img, _mask_np(face_mask, 0, img.shape[:2]), margin=margin, min_keep=min_keep)
        text = json.dumps(info)
        return {"ui": {"text": [text]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], text)}


def _kp_for(pose_keypoint, shape):
    """DWPose points scaled to this image's pixels."""
    kp, cw, ch = keypoints_from_pose(pose_keypoint) if pose_keypoint else ([], 0, 0)
    h, w = shape[:2]
    return scale_points(kp, w / cw, h / ch) if kp and cw and ch else kp


class SiennaGarmentOnly:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "person_mask": ("MASK",),
                "expect": ("STRING", {"default": "upper,lower"}),
                "drop_feet": ("BOOLEAN", {"default": False}),
            },
            "optional": {"face_mask": ("MASK",), "pose_keypoint": ("POSE_KEYPOINT",)},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, person_mask, expect, drop_feet=False, face_mask=None, pose_keypoint=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        pieces = [p.strip() for p in expect.split(",") if p.strip() in ("upper", "lower")]
        out, info = garment_only(img, _mask_np(person_mask, 0, shape), _mask_np(face_mask, 0, shape), _kp_for(pose_keypoint, shape), pieces, drop_feet=drop_feet, shrink_frac=0.005)
        text = json.dumps(info)
        return {"ui": {"text": [text]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], text)}


class SiennaBodySheet:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"image1": ("IMAGE",), "height": ("INT", {"default": 768, "min": 256, "max": 2048})},
            "optional": {"image2": ("IMAGE",), "image3": ("IMAGE",), "image4": ("IMAGE",),
                         **{f"mask{i}": ("MASK",) for i in range(1, 5)},
                         "backdrop": ("IMAGE",), "backdrop_mask": ("MASK",)},
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "sienna"

    def run(self, image1, height, image2=None, image3=None, image4=None, mask1=None, mask2=None, mask3=None, mask4=None,
            backdrop=None, backdrop_mask=None):
        pairs = [(i, m) for i, m in ((image1, mask1), (image2, mask2), (image3, mask3), (image4, mask4)) if i is not None]
        ims = [i[0].detach().cpu().numpy().astype(np.float32) for i, _ in pairs]
        masks = [_mask_np(m, 0, im.shape[:2]) for (_, m), im in zip(pairs, ims)]
        bg = None
        if backdrop is not None:
            b = backdrop[0].detach().cpu().numpy().astype(np.float32)
            bg = scene_backdrop(b, _mask_np(backdrop_mask, 0, b.shape[:2]))
        return (torch.from_numpy(np.ascontiguousarray(body_sheet(ims, height, masks=masks, backdrop=bg)))[None, ...],)


class SiennaBodyMeasure:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"image": ("IMAGE",), "pose_keypoint": ("POSE_KEYPOINT",), "person_mask": ("MASK",)},
            "optional": {"face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("measurements",)
    FUNCTION = "run"
    CATEGORY = "sienna"

    def run(self, image, pose_keypoint, person_mask, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        m = measure_body(img, _kp_for(pose_keypoint, shape), _mask_np(person_mask, 0, shape), _mask_np(face_mask, 0, shape))
        return (json.dumps(m, default=lambda o: None),)


class SiennaBodyCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": ("STRING", {"forceInput": True}),
                "result": ("STRING", {"forceInput": True}),
                "footwear_changed": ("BOOLEAN", {"default": False}),
                "legs_hidden": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "source_image": ("IMAGE",),
                "result_image": ("IMAGE",),
                **{f"ref{i}": ("STRING", {"forceInput": True}) for i in range(1, 7)},
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("report",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, source, result, footwear_changed=False, legs_hidden=False, source_image=None, result_image=None, **refs):
        try:
            report = compare(json.loads(source), json.loads(result), [json.loads(v) for v in refs.values() if v],
                             footwear_changed=footwear_changed, legs_hidden=legs_hidden)
        except (ValueError, TypeError, KeyError) as e:
            report = {"status": "insufficient", "flags": [], "checked": [], "skipped": [{"part": "all", "why": f"measurement failed: {e}"}]}
        if source_image is not None and result_image is not None:
            diff = scene_change(source_image[0].detach().cpu().numpy(), result_image[0].detach().cpu().numpy())
            report["scene"] = {"diff": diff, "changed": diff > SCENE_CHANGED}
        text = json.dumps(report)
        return {"ui": {"text": [text]}, "result": (text,)}


class SiennaGarmentRedrawMask:
    """Edit Outfit garment-only redraw: the region the editor may change, image 1 with the old garment greyed out,
    and a preview. The paste-back uses the feathered mask (ImageCompositeMasked)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "scope": (["full", "top", "bottom"],),
                "grow": (list(GROW_MODES),),
                "include_feet": ("BOOLEAN", {"default": False}),
            },
            "optional": {"person_mask": ("MASK",), "face_mask": ("MASK",), "pose_keypoint": ("POSE_KEYPOINT",)},
        }

    RETURN_TYPES = ("MASK", "MASK", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("mask", "soft_mask", "erased", "preview", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, scope, grow, include_feet, person_mask=None, face_mask=None, pose_keypoint=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        classes = segment_classes(img)
        hard, soft, info = garment_region(img, classes, _mask_np(person_mask, 0, shape), _mask_np(face_mask, 0, shape),
                                          _kp_for(pose_keypoint, shape), scope, grow, include_feet)
        if classes is None:
            info["segmenter_error"] = segmenter_error()
        text = json.dumps(info)
        t = lambda a: torch.from_numpy(np.ascontiguousarray(a))[None, ...]
        return {"ui": {"text": [text]}, "result": (t(hard), t(soft), t(erase(img, hard)), t(overlay(img, hard)), text)}


class SiennaExposureCheck:
    """Reports whether each image shows exposed nipples (the app regenerates with a new seed if the outfit had a top)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "threshold": ("FLOAT", {"default": DEFAULT_THRESHOLD, "min": 0.05, "max": 0.95, "step": 0.05})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("report",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, images, threshold):
        import os
        import tempfile

        import cv2

        det = detector()
        if det is None:
            text = json.dumps({"available": False, "error": detector_error()})
            return {"ui": {"text": [text]}, "result": (text,)}
        results = []
        for i in range(images.shape[0]):
            rgb = (np.clip(images[i].detach().cpu().numpy(), 0, 1) * 255).astype(np.uint8)
            fd, path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            try:
                cv2.imwrite(path, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
                results.append(summarize(det.detect(path), threshold))
            finally:
                os.remove(path)
        report = {"available": True, "exposed": any(r["exposed"] for r in results), "score": max(r["score"] for r in results), "images": results}
        text = json.dumps(report)
        return {"ui": {"text": [text]}, "result": (text,)}


class SiennaFaceCheck:
    """Cosine similarity of the main face to Sienna's approved-face embedding (the app redoes photos below threshold)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "reference": ("STRING", {"default": "[]", "multiline": True}),
                "threshold": ("FLOAT", {"default": 0.74, "min": 0.0, "max": 1.0, "step": 0.01}),
                "min_face": ("INT", {"default": 64, "min": 0, "max": 1024}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("report",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, images, reference, threshold, min_face):
        import os

        import cv2
        import folder_paths

        m = sienna_face.models(os.path.join(folder_paths.models_dir, "sienna"))
        try:
            ref = sienna_face.reference_embedding([json.loads(reference)])
        except (ValueError, TypeError):
            ref = None
        if m is None or ref is None or ref.size == 0:
            text = json.dumps({"available": False, "error": sienna_face.model_error() or "no reference embedding"})
            return {"ui": {"text": [text]}, "result": (text,)}
        results = []
        for i in range(images.shape[0]):
            rgb = (np.clip(images[i].detach().cpu().numpy(), 0, 1) * 255).astype(np.uint8)
            results.append(sienna_face.check(sienna_face.faces(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), *m), ref, threshold, min_face))
        sims = [r["similarity"] for r in results if r["found"]]
        report = {"available": True, "ok": all(r["ok"] for r in results), "similarity": min(sims) if sims else None, "images": results}
        text = json.dumps(report)
        return {"ui": {"text": [text]}, "result": (text,)}


class SiennaSafeFrame:
    """Video safe framing: adds only the room her movement needs around her (see sienna_frame.py). Outputs the padded
    photo at an SDXL-friendly size, the outpaint mask, the final video width/height and a JSON report."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "margins": ("STRING", {"default": '{"top": 0.24, "bottom": 0.03, "side": 0.08}'}),
                "target_area": ("INT", {"default": 399360, "min": 65536, "max": 4194304}),
                "max_pad": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.01}),
                "min_aspect": ("FLOAT", {"default": 0.5625, "min": 0.2, "max": 1.0, "step": 0.0025}),
                "feather": ("INT", {"default": 24, "min": 0, "max": 128}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "STRING")
    RETURN_NAMES = ("image", "outpaint_mask", "width", "height", "report")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, margins, target_area, max_pad, min_aspect, feather):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        h, w = img.shape[:2]
        try:
            m = {k: float(v) for k, v in json.loads(margins or "{}").items()}
        except (ValueError, TypeError):
            m = {}
        report = {"available": True, "margins": m, "source": [w, h]}
        box = sienna_frame.subject_box(segment_classes(img)) if any(m.values()) else None
        if box is None:
            plan = {"top": 0, "bottom": 0, "left": 0, "right": 0, "changed": False}
            if any(m.values()):
                report.update(available=False, error=segmenter_error() or "she was not found in the photo")
        else:
            plan = sienna_frame.plan_pads(box, m, max_pad=max_pad, min_aspect=min_aspect)
            report["subject"] = {k: round(v, 1) for k, v in box.items() if k not in ("img_w", "img_h")}
        padded, mask = sienna_frame.pad_image(img, plan, feather=feather)
        ph, pw = padded.shape[:2]
        fw, fh = sienna_frame.fill_size(pw, ph)
        if (fw, fh) != (pw, ph):
            padded = cv2.resize(padded, (fw, fh), interpolation=cv2.INTER_AREA)
            mask = cv2.resize(mask, (fw, fh), interpolation=cv2.INTER_LINEAR)
        vw, vh = sienna_frame.fit_area(pw, ph, int(target_area))
        report.update(plan=plan, padded=[pw, ph], video=[vw, vh])
        text = json.dumps(report)
        return {"ui": {"text": [text]},
                "result": (torch.from_numpy(padded[None]).float(), torch.from_numpy(mask[None]).float(), vw, vh, text)}


class SiennaLockCamera:
    """Lock Camera for videos: removes the camera's drift so the background stays where it is in the first frame
    (sienna_stabilize.py). Her body is found with the segmenter and left out of the tracking; frames are only moved
    as a whole (no warping), never cropped, and keep their count and timing. If a safety check fails the frames come
    back unchanged and the report says why (status applied / steady / rejected / unavailable)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "report")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, images):
        frames = (images.detach().cpu().numpy().clip(0, 1) * 255).round().astype(np.uint8)
        masks = []
        for f in frames:
            classes = segment_classes(f.astype(np.float32) / 255.0)
            if classes is None:
                masks = None
                break
            masks.append(classes[0] < 0.5)  # anything that isn't background is her (body, hair, clothes)
        try:
            out, report = sienna_stabilize.lock_camera(frames, masks)
        except Exception as e:  # never lose the video over the optional copy
            out, report = frames, {"status": "rejected", "reason": f"Lock Camera failed: {e}"}
        if masks is None and segmenter_error():
            report["segmenter_error"] = segmenter_error()
        text = json.dumps(report)
        result = images if out is frames else torch.from_numpy(out.astype(np.float32) / 255.0)
        return {"ui": {"text": [text]}, "result": (result, text)}


class SiennaFigureMask:
    """Figure pass (test only): the hip/butt region to resample with the figure LoRA; face, hair, hands and the arms
    beside her hips stay out. Empty mask (nothing redrawn) when her hips or outline aren't found."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "pose_keypoint": ("POSE_KEYPOINT",),
                "grow": ("FLOAT", {"default": 0.06, "min": 0.0, "max": 0.2, "step": 0.01}),
            },
            "optional": {"person_mask": ("MASK",), "face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("MASK", "MASK", "STRING")
    RETURN_NAMES = ("mask", "soft_mask", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, pose_keypoint, grow, person_mask=None, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        classes = segment_classes(img)
        person = _mask_np(person_mask, 0, shape)
        if person is None and classes:
            person = 1.0 - classes[0]
        hard, soft, info = sienna_figure.figure_region(shape, person, _kp_for(pose_keypoint, shape), classes,
                                                       _mask_np(face_mask, 0, shape), grow=grow)
        text = json.dumps(info)
        t = lambda a: torch.from_numpy(np.ascontiguousarray(a))[None, ...]
        return {"ui": {"text": [text]}, "result": (t(hard), t(soft), text)}


class SiennaFigureComposite:
    """Figure pass (test only): the redrawn region's skin and clothes colours matched to the original's, pasted into
    the original with the feathered mask; reports how much wider her outline got in the hip band."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "original": ("IMAGE",),
                "redrawn": ("IMAGE",),
                "mask": ("MASK",),
                "soft_mask": ("MASK",),
                "color_match": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, original, redrawn, mask, soft_mask, color_match):
        src = original[0].detach().cpu().numpy().astype(np.float32)
        red = redrawn[0].detach().cpu().numpy().astype(np.float32)
        if red.shape[:2] != src.shape[:2]:
            red = cv2.resize(red, (src.shape[1], src.shape[0]), interpolation=cv2.INTER_LANCZOS4)
        shape = src.shape[:2]
        hard, soft = _mask_np(mask, 0, shape), _mask_np(soft_mask, 0, shape)
        info = {}
        if hard is None or not (hard > 0.5).any():
            info["skipped"] = "empty region"
            out = src[..., :3]
        else:
            cs, cr = segment_classes(src), segment_classes(red)
            matched, info["color_shift"] = sienna_figure.match_colors(src, red, cv2.dilate((hard > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)),
                                                                    cs, cr, color_match)
            out = sienna_figure.composite(src, matched, soft)
            if cs:
                band = np.where((hard > 0.5).any(1))[0]
                co = segment_classes(out)
                if co is not None and band.size:
                    info.update(sienna_figure.outline_change(1.0 - cs[0], 1.0 - co[0], (band.min(), band.max())))
            else:
                info["segmenter_error"] = segmenter_error()
        text = json.dumps(info)
        return {"ui": {"text": [text]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], text)}


NODE_CLASS_MAPPINGS = {
    "SiennaPoseRetarget": SiennaPoseRetarget,
    "SiennaGarmentIsolate": SiennaGarmentIsolate,
    "SiennaChinCrop": SiennaChinCrop,
    "SiennaGarmentOnly": SiennaGarmentOnly,
    "SiennaBodySheet": SiennaBodySheet,
    "SiennaBodyMeasure": SiennaBodyMeasure,
    "SiennaBodyCheck": SiennaBodyCheck,
    "SiennaGarmentRedrawMask": SiennaGarmentRedrawMask,
    "SiennaExposureCheck": SiennaExposureCheck,
    "SiennaFaceCheck": SiennaFaceCheck,
    "SiennaSafeFrame": SiennaSafeFrame,
    "SiennaLockCamera": SiennaLockCamera,
    "SiennaFigureMask": SiennaFigureMask,
    "SiennaFigureComposite": SiennaFigureComposite,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SiennaPoseRetarget": "Sienna Pose Retarget",
    "SiennaGarmentIsolate": "Sienna Garment Isolate",
    "SiennaChinCrop": "Sienna Chin Crop",
    "SiennaGarmentOnly": "Sienna Garment Only",
    "SiennaBodySheet": "Sienna Body Sheet",
    "SiennaBodyMeasure": "Sienna Body Measure",
    "SiennaBodyCheck": "Sienna Body Check",
    "SiennaGarmentRedrawMask": "Sienna Garment Redraw Mask",
    "SiennaExposureCheck": "Sienna Exposure Check",
    "SiennaFaceCheck": "Sienna Face Check",
    "SiennaSafeFrame": "Sienna Safe Frame (video)",
    "SiennaLockCamera": "Sienna Lock Camera (video)",
    "SiennaFigureMask": "Sienna Figure Mask (test)",
    "SiennaFigureComposite": "Sienna Figure Composite (test)",
}
