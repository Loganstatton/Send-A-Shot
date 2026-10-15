"""DiffSynth's examples/wanvideo/model_training/train.py with the identity loss swapped in for `sft` tasks.
Run from the DiffSynth-Studio checkout with the same arguments as train.py."""
import os, runpy, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from face_loss import FlowMatchIdentityLoss
import diffsynth.diffusion.loss as dl
dl.FlowMatchSFTLoss = FlowMatchIdentityLoss          # train.py's task_to_loss lambdas resolve this name at call time
import diffsynth.diffusion as dd
if hasattr(dd, 'FlowMatchSFTLoss'):
    dd.FlowMatchSFTLoss = FlowMatchIdentityLoss
g = runpy.run_path('examples/wanvideo/model_training/train.py', init_globals={'FlowMatchSFTLoss': FlowMatchIdentityLoss}, run_name='__main__')
