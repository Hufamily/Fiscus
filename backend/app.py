from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.get('/api/health')
def health_check():
    return jsonify({'status': 'ok'})


@app.get('/api/onboarding-overview')
def onboarding_overview():
    return jsonify(
        {
            'organization': 'Example Nonprofit',
            'next_steps': [
                'Upload chart of accounts',
                'Connect existing filing sources',
                'Review monthly summary dashboard',
            ],
            'forms': ['Form 990', 'Grant budget summary', 'Board financial report'],
        }
    )


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
