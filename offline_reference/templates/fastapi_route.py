from fastapi import FastAPI
app=FastAPI()
@app.get('/api/hello')
def hello(name:str='DeveloperHCR'): return {'message':f'Hello {name}'}
