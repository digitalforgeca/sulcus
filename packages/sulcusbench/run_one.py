import sys
sys.path.insert(0, "src")
from sulcusbench.runner.runner import tasks, load_tasks_from_dir
from sulcusbench.adapters.agy_adapter import Adapter

load_tasks_from_dir("tasks")
from sulcusbench.runner.runner import _tasks
ad = Adapter()
ad.run_task(_tasks[0])
